// Che tipo di attività è: dà l'icona, i colori dello sfondo e lo strumento giusto (pomodoro, timer, conto alla rovescia).
// Lo decide il codice dalle parole del titolo (funziona anche senza AI); l'AI può solo scegliere tra questi temi.

const strip = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * I temi. pal = colori delle tre macchie dello sfondo (tema chiaro; in scuro si scuriscono da soli),
 * accent = colore del progresso, tool = lo strumento che compare quando l'attività parte.
 */
export const THEMES = {
  study: { label: 'Studio', icon: 'book-open-text', tool: 'pomodoro', accent: '#D21E2B', pal: ['#A9C1F2', '#C9D7F7', '#F3D9C9'] },
  yoga: { label: 'Yoga', icon: 'person-simple-tai-chi', tool: 'timer', accent: '#3E9C6B', pal: ['#BFE3CF', '#E0D6F4', '#F3EBDD'] },
  sport: { label: 'Allenamento', icon: 'barbell', tool: 'timer', accent: '#E0612F', pal: ['#F7C3A6', '#F9D9B5', '#F6E3EA'] },
  music: { label: 'Musica', icon: 'music-notes', tool: 'timer', accent: '#B0367E', pal: ['#E9B5D6', '#D9C0E8', '#F6E2EE'] },
  talk: { label: 'Chiamata', icon: 'phone', tool: 'countdown', accent: '#2F7FC1', pal: ['#B5D8F2', '#D2E6F7', '#EDE4F6'] },
  health: { label: 'Salute', icon: 'stethoscope', tool: 'countdown', accent: '#2E9C8F', pal: ['#B8E6DE', '#D6EFEA', '#E9E4F4'] },
  food: { label: 'Pasto', icon: 'fork-knife', tool: 'countdown', accent: '#C9821B', pal: ['#F5D7A8', '#F7E6C9', '#F6D9D2'] },
  errand: { label: 'Commissione', icon: 'shopping-cart', tool: 'timer', accent: '#C26A3A', pal: ['#F4CDB4', '#F7E0D0', '#E8E2D2'] },
  travel: { label: 'Viaggio', icon: 'airplane-tilt', tool: 'countdown', accent: '#1F9AA8', pal: ['#B2E3E8', '#CFE9F4', '#F3E6D2'] },
  work: { label: 'Lavoro', icon: 'briefcase', tool: 'pomodoro', accent: '#D21E2B', pal: ['#C9D1E0', '#DCE1EA', '#E9DCE4'] },
  create: { label: 'Creatività', icon: 'paint-brush', tool: 'timer', accent: '#7A55C8', pal: ['#D4C3F2', '#E3D9F7', '#F6DCE6'] },
  home: { label: 'Casa', icon: 'house', tool: 'timer', accent: '#8A7A5C', pal: ['#E6DCC8', '#EFE8DA', '#DCE6E2'] },
  fun: { label: 'Tempo libero', icon: 'confetti', tool: 'countdown', accent: '#D4567F', pal: ['#F6C1D3', '#F3D6E3', '#F8E3C8'] },
  rest: { label: 'Pausa', icon: 'moon', tool: 'timer', accent: '#6C5BA8', pal: ['#CFC6EC', '#DCD6F1', '#E3E9F2'] },
  generic: { label: 'Attività', icon: 'sparkle', tool: 'timer', accent: '#D21E2B', pal: null },
};
export const THEME_KEYS = Object.keys(THEMES);

// parole → tema (e, se serve, un'icona più precisa). L'ordine conta: vince la prima regola che corrisponde.
const RULES = [
  [/\b(yoga|pilates|stretching)\b/, 'yoga', 'person-simple-tai-chi'],
  [/\b(meditaz\w*|medita\w*|respir\w*|mindful\w*)\b/, 'yoga', 'flower-lotus'],
  [/\b(corsa|correre|running|jogging|corro)\b/, 'sport', 'person-simple-run'],
  [/\b(bici\w*|ciclism\w*|spinning)\b/, 'sport', 'bicycle'],
  [/\b(nuot\w*|piscina)\b/, 'sport', 'person-simple-swim'],
  [/\b(calcetto|calcio|partita|padel|tennis|basket|pallavolo)\b/, 'sport', 'soccer-ball'],
  [/\b(palestra|allenament\w*|pesi|crossfit|workout|gym|sport)\b/, 'sport', 'barbell'],
  [/\b(passeggiat\w*|camminat\w*|camminare)\b/, 'yoga', 'person-simple-walk'],
  [/\b(cane|veterinari\w*)\b/, 'home', 'dog'],
  [/\b(dentist\w*)\b/, 'health', 'tooth'],
  [/\b(farmac\w*|medicin\w*|pastigli\w*)\b/, 'health', 'pill'],
  [/\b(medic\w*|dottor\w*|visita|ospedal\w*|fisioterap\w*|analisi del sangue|cardiolog\w*)\b/, 'health', 'stethoscope'],
  [/\b(chitarra)\b/, 'music', 'guitar'],
  [/\b(canto|cantare|registrazione voce|voce)\b/, 'music', 'microphone-stage'],
  [/\b(beat|mix|master\w*|brano|brani|traccia|tracce|ep|album|canzon\w*|registra\w*|arrangiament\w*|produzion\w*|suonare|prove|musica|piano|pianoforte|dj)\b/, 'music', 'music-notes'],
  [/\b(ascoltare|podcast)\b/, 'music', 'headphones'],
  [/\b(videochiamat\w*|zoom|meet|teams)\b/, 'talk', 'video-camera'],
  [/\b(riunion\w*|meeting|colloqui\w*|incontro|team|call)\b/, 'talk', 'users-three'],
  [/\b(chiamat\w*|chiamare|telefon\w*|chiama)\b/, 'talk', 'phone'],
  [/\b(caffe|colazione|aperitivo|bar)\b/, 'food', 'coffee'],
  [/\b(pranzo|cena|ristorante|cucinare|cucina|mangiare|pizza)\b/, 'food', 'fork-knife'],
  [/\b(compleanno|torta)\b/, 'fun', 'cake'],
  [/\b(festa|amici|uscita|esco|serata|concerto)\b/, 'fun', 'confetti'],
  [/\b(cinema|film|serie)\b/, 'fun', 'film-slate'],
  [/\b(videogioc\w*|giocare|play|gaming)\b/, 'fun', 'game-controller'],
  [/\b(mare|spiaggia|vacanz\w*)\b/, 'travel', 'island'],
  [/\b(macchina|auto|meccanic\w*|benzina|tagliando|revisione)\b/, 'travel', 'car'],
  [/\b(viaggi\w*|volo|aereo|aeroporto|partenz\w*|treno|valigia|parto|londra|hotel)\b/, 'travel', 'airplane-tilt'],
  [/\b(spesa|supermercato|comprare|compra|negozi\w*|regalo|acquist\w*)\b/, 'errand', 'shopping-cart'],
  [/\b(pagare|bolletta|affitto|banca|tasse|bonifico|f24|commercialista)\b/, 'errand', 'credit-card'],
  [/\b(lavatrice|bucato|stirare|lavastoviglie)\b/, 'home', 'washing-machine'],
  [/\b(pulizi\w*|pulire|riordin\w*|aspirapolvere|casa)\b/, 'home', 'broom'],
  [/\b(aggiust\w*|riparar\w*|idraulic\w*|montare)\b/, 'home', 'wrench'],
  [/\b(piant\w*|giardin\w*|orto)\b/, 'home', 'plant'],
  [/\b(design|grafic\w*|disegn\w*|illustra\w*|portfolio|caso studio|logo|figma)\b/, 'create', 'palette'],
  [/\b(esame|esami|studi\w*|ripass\w*|lezion\w*|universit\w*|compit\w*|tesi|capitol\w*|appunti|corso|inglese|lingua|quiz|interrogazion\w*|test)\b/, 'study', 'book-open-text'],
  [/\b(laurea|seminario)\b/, 'study', 'graduation-cap'],
  [/\b(leggere|lettura|libro|pagine)\b/, 'study', 'book'],
  [/\b(scrivere|scrittura|articol\w*|blog|post|copy|testi)\b/, 'create', 'pencil-simple-line'],
  [/\b(foto\w*|shooting|video)\b/, 'create', 'camera'],
  [/\b(codice|programm\w*|sviluppo|bug|deploy|informatica|app|sito)\b/, 'work', 'code'],
  [/\b(mail|email|e-mail|rispondere|newsletter)\b/, 'work', 'envelope-simple'],
  [/\b(scadenz\w*|consegna\w*|deadline)\b/, 'work', 'flag'],
  [/\b(lavoro|ufficio|turno|report|relazione|presentazione|cliente|progetto|preventiv\w*)\b/, 'work', 'briefcase'],
  [/\b(dormire|riposo|pisolino|relax|decompressione|sonno)\b/, 'rest', 'moon'],
  [/\b(idea|idee|brainstorm\w*|pensare)\b/, 'create', 'lightbulb'],
];

/**
 * Il tema di un'attività: { key, label, icon, tool, accent, pal }.
 * item: { title, theme?, kind?, project? }, projectName: per «Mix e Master EP» → musica.
 */
export function themeOf(item, projectName = '') {
  if (!item) return { key: 'generic', ...THEMES.generic };
  if (item.kind === 'rest') return { key: 'rest', ...THEMES.rest };
  const forced = item.theme && THEMES[item.theme] ? item.theme : null;
  const text = ` ${strip(item.title)} ${strip(projectName)} `.replace(/[^a-z0-9' ]/g, ' ');
  for (const [re, key, icon] of RULES) {
    if (re.test(text) && (!forced || forced === key)) return { key, ...THEMES[key], icon: icon || THEMES[key].icon };
  }
  const key = forced || 'generic';
  return { key, ...THEMES[key] };
}

/** Tutte le icone usate (per la cache offline). */
export const ICONS = [...new Set([...Object.values(THEMES).map((t) => t.icon), ...RULES.map((r) => r[2])])];
