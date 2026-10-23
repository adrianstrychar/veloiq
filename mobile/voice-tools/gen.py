import json, os, sys, torch, torchaudio
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
REF = "../ref_D1deep.wav"
items = json.load(open('manifest.json'))
os.makedirs('clips', exist_ok=True)
model = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
model.prepare_conditionals(REF, exaggeration=1.5)  # raz, zamiast przy każdym klipie
done = 0
for it in items:
    if done >= 40: sys.exit(3)  # restart procesu – model na CPU stopniowo zjada pamięć
    out = f"clips/{it['id']}.wav"
    if os.path.exists(out): continue
    ex, cfg, temp = it['p']
    torch.manual_seed(101)
    wav = model.generate(it['text'], language_id="pl", exaggeration=ex, cfg_weight=cfg, temperature=temp)
    torchaudio.save(out + ".tmp.wav", wav, model.sr); os.replace(out + ".tmp.wav", out)
    print("ok", it['id'], flush=True)
    done += 1
print("DONE", flush=True)
