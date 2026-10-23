# Klipy WAV → paczka do aplikacji: przycięta cisza, wyrównana głośność, brzmienie radia, AAC (m4a) + manifest.
import json, os, subprocess, sys
out = sys.argv[1] if len(sys.argv) > 1 else 'dist/enzo'
os.makedirs(out, exist_ok=True)
items = {x['id']: x for x in json.load(open('manifest.json'))}
RADIO = ('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,'
         'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse,'
         'loudnorm=I=-16:TP=-1.5:LRA=9,highpass=f=260,lowpass=f=3400,'
         'acompressor=threshold=0.12:ratio=5:attack=4:release=60,volume=1.4,alimiter=limit=0.95,'
         'apad=pad_dur=0.06')
def dur(p):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).decode())
clips = {}
for f in sorted(os.listdir('clips')):
    if not f.endswith('.wav') or '.tmp.' in f: continue
    cid = f[:-4]; dst = f'{out}/{cid}.m4a'
    if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(f'clips/{f}'):
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', f'clips/{f}', '-af', RADIO, '-ac', '1', '-ar', '24000', '-c:a', 'aac', '-b:a', '48k', dst], check=True)
    clips[cid] = {'file': f'{cid}.m4a', 'dur': round(dur(dst), 2)}
    if items.get(cid, {}).get('it'): clips[cid]['it'] = True
# piknięcie radia + krótki szum otwarcia kanału
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=1400:duration=0.08', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.03:duration=0.14',
  '-filter_complex', '[0]volume=0.3[a];[1]highpass=f=300,lowpass=f=3400[b];[a][b]concat=n=2:v=0:a=1', '-ac', '1', '-ar', '24000', '-c:a', 'aac', '-b:a', '48k', f'{out}/fx.beep.m4a'], check=True)
clips['fx.beep'] = {'file': 'fx.beep.m4a', 'dur': round(dur(f'{out}/fx.beep.m4a'), 2)}
json.dump({'id': 'enzo', 'name': 'Dyrektor Enzo', 'version': 2, 'clips': clips}, open(f'{out}/manifest.json', 'w'), ensure_ascii=False)
total = sum(os.path.getsize(f'{out}/{c["file"]}') for c in clips.values())
print(f'{len(clips)} klipów, {total/1e6:.1f} MB, brakuje {len(items) - (len(clips) - 1)}')
