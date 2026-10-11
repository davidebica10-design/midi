"""
Adattatore HTTP per un modello decisionale contrastivo come CLM-8B (Contrastive-LM/CLM, Apache 2.0).

Contratto usato da Tempo (js/decide.js, motore «clm»):
    POST /decide   {"state": "testo dello stato", "actions": ["azione 1", "azione 2", ...]}
    →              {"scores": [s1, s2, ...]}        (stesso ordine delle azioni, più alto = migliore)

Tempo usa i punteggi solo per scegliere tra opzioni che ha già calcolato e validato; li mescola con le
sue regole e, se il servizio non risponde in 2,5 secondi, decide da solo.

Avvio:
    pip install fastapi uvicorn
    # installa CLM seguendo il README di https://github.com/Contrastive-LM/CLM (pesi su Hugging Face:
    # Contrastive-LM/CLM-v0.1-8B; serve una GPU con ~20 GB, oppure la versione GGUF quantizzata)
    uvicorn serve:app --host 0.0.0.0 --port 8000

Poi in Tempo: ⋯ → Decisioni → «CLM-8B» → https://<il-tuo-server>/decide
"""
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
import os

app = FastAPI(title="Tempo · adattatore CLM")
TOKEN = os.environ.get("CLM_TOKEN")  # facoltativo: Tempo lo manda come «Authorization: Bearer …»


class Req(BaseModel):
    state: str = Field(max_length=4000)
    actions: list[str] = Field(min_length=1, max_length=32)


_model = None


def load():
    """Carica CLM una volta sola. Sostituisci il corpo con il caricamento indicato nel README di CLM:
    il modello espone un codificatore dello stato e uno delle azioni nello stesso spazio."""
    global _model
    if _model is None:
        raise HTTPException(503, "CLM non è installato su questo server: segui il README di Contrastive-LM/CLM e completa load()/score().")
    return _model


def score(state: str, actions: list[str]) -> list[float]:
    """Somiglianza tra la rappresentazione dello stato e quella di ogni azione (vince la più vicina)."""
    model = load()
    s = model.encode_state(state)          # nomi indicativi: usa quelli dell'API di CLM
    a = model.encode_actions(actions)
    return [float(x) for x in (a @ s)]


@app.post("/decide")
def decide(req: Req, authorization: str | None = Header(default=None)):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "token mancante o sbagliato")
    return {"scores": score(req.state, req.actions)}


@app.get("/health")
def health():
    return {"ok": True, "loaded": _model is not None}
