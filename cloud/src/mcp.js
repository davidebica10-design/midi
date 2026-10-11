// Server MCP (Model Context Protocol, trasporto Streamable HTTP senza sessione): Claude, ChatGPT e gli
// altri assistenti possono leggere il tuo tempo e proporre modifiche. Le modifiche passano dalle stesse
// regole dell'app: quelle grandi non si applicano da qui, si confermano sul telefono.
const PROTOCOL = '2025-06-18';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const TOOLS = [
  {
    name: 'tempo_adesso',
    title: 'Cosa fare adesso',
    description: 'Cosa conviene fare adesso secondo Tempo (una sola cosa, con il perché) e le prossime attività di oggi.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'tempo_giornata',
    title: 'La giornata',
    description: 'Le attività e gli impegni di un giorno (oggi se non indicato) con gli orari decisi dallo scheduler di Tempo.',
    inputSchema: { type: 'object', properties: { giorno: { type: 'string', description: 'Data YYYY-MM-DD (facoltativa, entro 14 giorni)' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'tempo_mese',
    title: 'Il mese',
    description: 'Il racconto del mese: sessioni fatte, ore, progetti, ritmo, obiettivi.',
    inputSchema: { type: 'object', properties: { mese: { type: 'string', description: 'Mese YYYY-MM (facoltativo, quello corrente se manca)' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'tempo_dimmi',
    title: 'Dì a Tempo',
    description: 'Dice a Tempo qualcosa in italiano, come nella barra dell\'app: «domani alle 16 call con Marco», «ho finito il beat 02», «stasera ho solo 2 ore». Tempo decide gli orari; le modifiche grandi vanno confermate sul telefono.',
    inputSchema: { type: 'object', properties: { testo: { type: 'string', description: 'La frase da dire a Tempo' } }, required: ['testo'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

const ok = (id, result) => ({ body: { jsonrpc: '2.0', id, result } });
const fail = (id, code, message) => ({ body: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } });
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

/** api: { now(), day(giorno), recap(mese), tell(testo) } — già legate all'utente autenticato. */
export async function handleMcp(msg, api) {
  if (Array.isArray(msg)) return fail(null, -32600, 'Richieste in blocco non supportate');
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Richiesta non valida');
  const { id, method, params = {} } = msg;
  // notifiche (senza id): nessuna risposta
  if (id === undefined) return { status: 202, empty: true };
  try {
    switch (method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'tempo', title: 'Tempo', version: '1.0.0' },
          instructions: 'Tempo organizza il tempo dell\'utente. Usa tempo_adesso per sapere cosa fare ora, tempo_giornata per gli orari, tempo_mese per il bilancio, tempo_dimmi per aggiungere o cambiare cose (in italiano). Non inventare orari: li decide Tempo.',
        });
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: TOOLS });
      case 'tools/call': {
        const name = params.name;
        const args = params.arguments || {};
        if (name === 'tempo_adesso') { const r = await api.now(); return ok(id, { ...text(`${r.text}${r.next.length ? `\nPoi: ${r.next.map((n) => `${n.start} ${n.title}`).join(', ')}` : ''}`), structuredContent: r }); }
        if (name === 'tempo_giornata') { const r = await api.day(args.giorno || null); return ok(id, { ...text(r.text), structuredContent: r }); }
        if (name === 'tempo_mese') { const r = await api.recap(args.mese || null); return ok(id, { ...text(r.text), structuredContent: { month: r.month, sessions: r.sessions, minutes: r.minutes } }); }
        if (name === 'tempo_dimmi') {
          if (typeof args.testo !== 'string' || !args.testo.trim()) return ok(id, text('Manca il testo.', true));
          const r = await api.tell(args.testo);
          return ok(id, { ...text(`${r.reply}${r.understood?.length ? `\nCapito: ${r.understood.join(' · ')}` : ''}`, !r.applied && !r.confirm && !r.understood?.length), structuredContent: r });
        }
        return fail(id, -32602, `Strumento sconosciuto: ${name}`);
      }
      default:
        return fail(id, -32601, `Metodo non supportato: ${method}`);
    }
  } catch (e) {
    if (e?.status && e.status < 500) return ok(id, text(e.message, true));
    throw e;
  }
}
