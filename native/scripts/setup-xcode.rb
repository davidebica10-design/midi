#!/usr/bin/env ruby
# Prepara il progetto Xcode creato da «npx cap add ios»: copia i sorgenti Swift, aggiunge il widget
# (Widget Extension con Live Activity), i permessi (App Groups), le chiavi di Info.plist e alza il livello
# minimo di iOS a 17. Tutto quello che altrimenti si farebbe cliccando in Xcode.
#
#   ruby scripts/setup-xcode.rb [--team ABCDE12345] [--carplay]
#
# Serve la gemma xcodeproj (quella di CocoaPods):  gem install xcodeproj   (oppure sudo gem install xcodeproj)
begin
  require 'xcodeproj'
rescue LoadError
  abort "Manca la gemma xcodeproj. Installala con:  gem install xcodeproj   (se chiede i permessi: sudo gem install xcodeproj)"
end
require 'json'
require 'fileutils'

ROOT = File.expand_path('..', __dir__)             # native/
SRC = File.join(ROOT, 'ios-src')
IOS = File.join(ROOT, 'ios', 'App')                # la cartella che contiene App.xcodeproj
PROJ = File.join(IOS, 'App.xcodeproj')
abort 'Prima esegui «npx cap add ios» (manca ios/App/App.xcodeproj).' unless File.exist?(PROJ)

args = ARGV.dup
team = (i = args.index('--team')) ? args[i + 1] : nil
carplay = args.include?('--carplay')
min_ios = '17.0'
app_id = JSON.parse(File.read(File.join(ROOT, 'capacitor.config.json')))['appId']
group_id = "group.#{app_id}"
widget_id = "#{app_id}.widgets"

# ---- 1. copia i sorgenti Swift dove li aspetta il progetto
app_dir = File.join(IOS, 'App')
tempo_dir = File.join(app_dir, 'Tempo')
FileUtils.rm_rf(tempo_dir)
%w[App Shared].each { |d| FileUtils.mkdir_p(File.join(tempo_dir, d)); FileUtils.cp_r(Dir.glob(File.join(SRC, d, '*.swift')), File.join(tempo_dir, d)) }
if carplay
  FileUtils.mkdir_p(File.join(tempo_dir, 'CarPlay'))
  FileUtils.cp_r(Dir.glob(File.join(SRC, 'CarPlay', '*.swift')), File.join(tempo_dir, 'CarPlay'))
end
widget_dir = File.join(IOS, 'TempoWidgets')
FileUtils.rm_rf(widget_dir)
FileUtils.mkdir_p(widget_dir)
FileUtils.cp_r(Dir.glob(File.join(SRC, 'Widgets', '*.swift')), widget_dir)

# il gruppo di app negli sorgenti Swift deve essere quello del tuo bundle id
shared = File.join(tempo_dir, 'Shared', 'TempoShared.swift')
File.write(shared, File.read(shared).gsub('group.app.tempo.companion', group_id))

# il modello di Capacitor crea la finestra con CAPBridgeViewController: serve il nostro, che registra il plugin
scene = File.join(app_dir, 'SceneDelegate.swift')
if File.exist?(scene)
  src = File.read(scene)
  File.write(scene, src.sub('CAPBridgeViewController()', 'MainViewController()')) if src.include?('CAPBridgeViewController()') && !src.include?('MainViewController()')
else
  warn 'Attenzione: non trovo SceneDelegate.swift. In AppDelegate/SceneDelegate usa MainViewController() al posto di CAPBridgeViewController().'
end

# ---- 2. permessi (App Groups) per l'app e per il widget
ent = { 'com.apple.security.application-groups' => [group_id] }
Xcodeproj::Plist.write_to_path(ent, File.join(app_dir, 'App.entitlements'))
Xcodeproj::Plist.write_to_path(ent, File.join(widget_dir, 'TempoWidgets.entitlements'))

# ---- 3. Info.plist dell'app
info_path = File.join(app_dir, 'Info.plist')
info = Xcodeproj::Plist.read_from_path(info_path)
info['CFBundleDevelopmentRegion'] = 'it' # le frasi di Siri sono in italiano
info['NSSupportsLiveActivities'] = true
info['NSSupportsLiveActivitiesFrequentUpdates'] = false
info['NSSpeechRecognitionUsageDescription'] = 'Per capire cosa dici a Tempo in auto.'
info['NSMicrophoneUsageDescription'] = 'Per parlare con Tempo in auto.'
info['CFBundleURLTypes'] = [{ 'CFBundleURLName' => app_id, 'CFBundleURLSchemes' => ['tempo'] }]
if carplay
  mf = info['UIApplicationSceneManifest'] ||= {}
  mf['UIApplicationSupportsMultipleScenes'] = true
  (mf['UISceneConfigurations'] ||= {})['CPTemplateApplicationSceneSessionRoleApplication'] = [{
    'UISceneConfigurationName' => 'CarPlay', 'UISceneClassName' => 'CPTemplateApplicationScene',
    'UISceneDelegateClassName' => '$(PRODUCT_MODULE_NAME).CarPlaySceneDelegate'
  }]
end
Xcodeproj::Plist.write_to_path(info, info_path)

# Info.plist del widget
Xcodeproj::Plist.write_to_path({
  'CFBundleDevelopmentRegion' => 'it', 'CFBundleDisplayName' => 'Tempo', 'CFBundleExecutable' => '$(EXECUTABLE_NAME)',
  'CFBundleIdentifier' => '$(PRODUCT_BUNDLE_IDENTIFIER)', 'CFBundleInfoDictionaryVersion' => '6.0', 'CFBundleName' => '$(PRODUCT_NAME)',
  'CFBundlePackageType' => 'XPC!', 'CFBundleShortVersionString' => '$(MARKETING_VERSION)', 'CFBundleVersion' => '$(CURRENT_PROJECT_VERSION)',
  'NSExtension' => { 'NSExtensionPointIdentifier' => 'com.apple.widgetkit-extension' }
}, File.join(widget_dir, 'Info.plist'))

# ---- 4. il progetto
project = Xcodeproj::Project.open(PROJ)
app = project.targets.find { |t| t.name == 'App' } or abort 'Non trovo il target «App» nel progetto.'
project.build_configurations.each { |c| c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = min_ios }

# togli quello che aveva aggiunto una esecuzione precedente (lo script si può rilanciare senza duplicare niente)
project.targets.select { |t| t.name == 'TempoWidgets' }.each do |t|
  app.dependencies.select { |d| d.target == t }.each(&:remove_from_project)
  app.copy_files_build_phases.select { |p| p.name == 'Embed Foundation Extensions' }.each(&:remove_from_project)
  t.remove_from_project
end
[project.main_group['App'] && project.main_group['App']['Tempo'], project.main_group['TempoWidgets']].compact.each do |g|
  g.recursive_children.grep(Xcodeproj::Project::Object::PBXFileReference).each(&:remove_from_project) # toglie anche le voci di compilazione
  g.remove_from_project
end
project.main_group['App'].files.select { |f| f.path == 'App.entitlements' }.each(&:remove_from_project)

app_group = project.main_group['App'] or abort 'Non trovo il gruppo «App».'
tempo_group = app_group.new_group('Tempo', 'Tempo')
refs = {}
%w[App Shared CarPlay].each do |d|
  dir = File.join(tempo_dir, d)
  next unless Dir.exist?(dir)
  grp = tempo_group.new_group(d, d)
  Dir.glob(File.join(dir, '*.swift')).sort.each { |f| refs[File.join(d, File.basename(f))] = grp.new_file(File.basename(f)) }
end
app.add_file_references(refs.values)
app_ent_ref = app_group.new_file('App.entitlements')

app.build_configurations.each do |c|
  s = c.build_settings
  s['IPHONEOS_DEPLOYMENT_TARGET'] = min_ios
  s['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements'
  s['DEVELOPMENT_TEAM'] = team if team
end
version = app.build_configurations.first.build_settings.values_at('MARKETING_VERSION', 'CURRENT_PROJECT_VERSION')

# il widget (Widget Extension)
widget_group = project.main_group.new_group('TempoWidgets', 'TempoWidgets')
widget_swift = widget_group.new_file('TempoWidgets.swift')
widget_group.new_file('Info.plist')
widget_group.new_file('TempoWidgets.entitlements')
widget = project.new_target(:app_extension, 'TempoWidgets', :ios, min_ios, nil, :swift)
widget.add_file_references([widget_swift, refs['Shared/TempoShared.swift']])
widget.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = widget_id
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = 'TempoWidgets/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = 'TempoWidgets/TempoWidgets.entitlements'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['DEVELOPMENT_TEAM'] = team if team
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = min_ios
  s['SKIP_INSTALL'] = 'YES'
  s['MARKETING_VERSION'] = version[0] || '1.0'
  s['CURRENT_PROJECT_VERSION'] = version[1] || '1'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

# il widget va dentro l'app
embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
bf = embed.add_file_reference(widget.product_reference, true)
bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
app.add_dependency(widget)
project.save

# ---- 5. controllo: ricarica il progetto e riassume
chk = Xcodeproj::Project.open(PROJ)
puts "Progetto aggiornato (livello minimo iOS #{min_ios}, gruppo di app #{group_id}):"
chk.targets.each do |t|
  files = t.source_build_phase.files.map { |f| f.file_ref&.path }.compact.sort
  puts "  • #{t.name} (#{t.product_type.split('.').last}): #{files.join(', ')}"
  t.dependencies.each { |d| puts "      dipende da #{d.target&.name}" }
  t.copy_files_build_phases.each { |p| puts "      fase «#{p.name}»: #{p.files.map { |f| f.file_ref&.path }.join(', ')}" }
end
missing = chk.files.select { |f| f.path.to_s =~ /\.(swift|entitlements)\z/ }.reject { |f| File.exist?(f.real_path) }
abort "File nel progetto che non esistono su disco: #{missing.map(&:path).join(', ')}" unless missing.empty?
puts team ? "Team di firma: #{team}" : "Manca il team di firma: in Xcode, per i target App e TempoWidgets, scegli il tuo team in «Signing & Capabilities»."
puts 'CarPlay: incluso (serve il permesso di Apple, vedi README.md).' if carplay
