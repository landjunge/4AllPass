#!/usr/bin/env python3
"""Private macOS normal-startup WKWebView journey. No install, real profile or grants.

Requires an independently prepared private Python3.12 venv with the existing
backend requirements and hashed requirements-sidecar.txt. Never installs deps.
Preserves HOME/CODEX_HOME. Refuses occupied8788 without terminating its owner.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def port_free():
    # Bind plus lsof: also refuse unknown/listening owners on other interfaces.
    found = subprocess.run(['/usr/sbin/lsof','-nP','-t','-iTCP:8788','-sTCP:LISTEN'],
                           capture_output=True, text=True)
    if found.returncode not in (0,1) or found.stdout.strip():
        return False
    try:
        with socket.socket() as sock:
            # Ignore only stale TIME_WAIT from our previous orderly server exit.
            # Existing listeners are still refused above and by native ownership.
            sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            sock.bind(('127.0.0.1',8788))
        return True
    except OSError:
        return False

def run(command, log, *, env, cwd=ROOT, timeout=600):
    with log.open('w') as stream:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=stream,
                                stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'command failed ({result.returncode}); private log: {log}')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--build-python',type=Path,required=True)
    args = parser.parse_args()
    if sys.platform!='darwin': parser.error('requires native macOS WKWebView')
    os.umask(0o077)
    output=args.output.resolve()
    output.mkdir(parents=True,exist_ok=True)
    output.chmod(0o700)
    env={k:v for k,v in os.environ.items() if not k.startswith(('FOURALLPASS_','TAURI_','VITE_','PYTHON'))}
    for key in ['DATABASE_URL','REDIS_URL','API_ORIGIN','CARGO_TARGET_DIR']:
        env.pop(key,None)
    # Verify isolated interpreter identity; do not modify another environment.
    args.build_python.resolve(strict=True)
    # Preserve the venv launcher symlink.
    python=args.build_python.absolute()
    identity=subprocess.check_output([str(python),'-I','-c',
        'import json,sys,importlib.metadata as m; print(json.dumps(dict(version=sys.version,prefix=sys.prefix,base_prefix=sys.base_prefix,pyinstaller=m.version("pyinstaller"),hooks=m.version("pyinstaller-hooks-contrib"))))'],env=env,text=True)
    identity=json.loads(identity)
    if not identity['version'].startswith('3.12.') or identity['prefix']==identity['base_prefix'] or identity['pyinstaller']!='6.22.2' or identity['hooks']!='2026.7':
        raise RuntimeError('private buildvenv/pinned packager required')
    build=output/'build'; build.mkdir(exist_ok=True)
    dist=build/'dist'
    run(['npm','run','build','-w','@4allpass/frontend','--','--outDir',str(dist)],
        output/'frontend-build.log',env=env)
    sources=sorted([*(ROOT/'backend/app').rglob('*.py'),
                    ROOT/'backend/requirements.txt',ROOT/'backend/requirements-sidecar.txt',
                    ROOT/'LICENSE'])
    inputs={str(p.relative_to(ROOT)):digest(p) for p in sources}
    inputs.update({'dist/'+str(p.relative_to(dist)):digest(p) for p in sorted(dist.rglob('*')) if p.is_file()})
    sidecar=build/'sidecar/fourallpass-core'
    receipt=build/'sidecar-inputs.json'
    previous=json.loads(receipt.read_text()) if receipt.exists() else {}
    if not sidecar.is_file() or previous.get('inputs')!=inputs or previous.get('binarySha256')!=digest(sidecar):
        command=[str(python),'-I','-m','PyInstaller','--noconfirm','--clean','--onefile',
                 '--name','fourallpass-core','--paths',str(ROOT/'backend'),
                 '--distpath',str(sidecar.parent),'--workpath',str(build/'pyinstaller-work'),
                 '--specpath',str(build),'--add-data',str(dist)+':frontend/dist',
                 '--add-data',str(ROOT/'LICENSE')+':.']
        for module in ['uvicorn.logging','uvicorn.loops.auto','uvicorn.protocols.http.auto',
                       'uvicorn.protocols.websockets.auto','uvicorn.lifespan.on','aiosqlite',
                       'greenlet','app.main','app.local','app.broker']:
            command+=['--hidden-import',module]
        command+=[str(ROOT/'backend/app/local.py')]
        run(command,output/'sidecar-build.log',env=env,cwd=build)
        receipt.write_text(json.dumps({'inputs':inputs,'binarySha256':digest(sidecar)},indent=2)+'\n')
    config=json.loads((ROOT/'src-tauri/tauri.conf.json').read_text())
    window=config['app']['windows'][0]
    window.update({'create':False,'incognito':True,'title':'4AllPass private normal journey'})
    overlay={'productName':'4AllPass Normal Journey Probe',
             'identifier':'de.netzwerkpunkt.fourallpass.normal-journey-probe',
             'build':{'beforeDevCommand':None,'beforeBuildCommand':None,'devUrl':None,'frontendDist':str(dist)},
             'app':{'windows':[window]},
             'bundle':{'active':False,'externalBin':[],'resources':[]}}
    env['TAURI_CONFIG']=json.dumps(overlay)
    env['CARGO_TARGET_DIR']=str(build/'cargo-target')
    (build/'tauri-overlay.json').write_text(json.dumps(overlay,indent=2)+'\n')
    run(['cargo','build','--locked','--manifest-path',str(ROOT/'src-tauri/Cargo.toml'),
         '--features','custom-protocol,native-normal-journey-probe',
         '--bin','fourallpass-normal-journey-probe','--jobs','2'],output/'native-build.log',env=env,timeout=1200)
    binary=build/'cargo-target/debug/fourallpass-normal-journey-probe'
    shutil.copy2(sidecar,binary.parent/'fourallpass-core')
    # Actual negative startup: keep our own synthetic listener alive. The test
    # feature must refuse it before spawning a sidecar or touching a data dir.
    if not port_free(): raise RuntimeError('8788 occupied before negative probe; no process changed')
    occupied_task=output/('occupied-'+uuid.uuid4().hex)
    occupied_env=env.copy(); occupied_env.pop('TAURI_CONFIG',None)
    occupied_env['FOURALLPASS_DATA_DIR']=str(occupied_task/'data')
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        listener.bind(('127.0.0.1',8788)); listener.listen(2)
        with (output/'occupied-port.log').open('w') as log:
            refused=subprocess.run([str(binary),str(occupied_task)],cwd=output,
                env=occupied_env,stdout=log,stderr=subprocess.STDOUT,timeout=20)
        occupied_refused=refused.returncode==1 and not (occupied_task/'data').exists()
        occupied_refused=occupied_refused and not port_free()
        if not occupied_refused: raise RuntimeError('occupied-port startup did not refuse safely')
    task=output/('run-'+uuid.uuid4().hex)
    runtime_env=env.copy()
    runtime_env.pop('TAURI_CONFIG',None)
    runtime_env['FOURALLPASS_DATA_DIR']=str(task/'data')
    if not port_free(): raise RuntimeError('8788 occupied/unknown: refused without spawn or reap')
    run([str(binary),str(task)],output/'native.log',env=runtime_env,cwd=output,timeout=200)
    result=json.loads((task/'native-result.json').read_text())
    for _ in range(30):
        if port_free(): break
        time.sleep(0.1)
    if not port_free(): raise RuntimeError('8788 still held after own app exit; no foreign cleanup attempted')
    # Only the fresh task DB. No plaintext dump, credentials or kit values.
    db=task/'data/vault.db'
    with sqlite3.connect(db.as_uri()+'?mode=ro',uri=True) as connection:
        tables={row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        counts={name:connection.execute('SELECT count(*) FROM "'+name+'"').fetchone()[0]
                for name in ['users','vaults','vault_snapshots','encrypted_entries'] if name in tables}
    synthetic_markers=[b'Native fixture alpha',b'Native fixture beta',b'Synthetic file fixture only 2026!',
                       b'Native journey fixture password 2026!']
    opaque=all(marker not in db.read_bytes() for marker in synthetic_markers)
    evidence={'sourcePin':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
              'sourceDirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True)),
              'normalStartup':True,'nativeResult':result,'privateDbCounts':counts,
              'noSyntheticPlaintextInDb':opaque,'portReleased':True,'python':identity,
              'occupiedPortRefusedBeforeSpawnAndData':occupied_refused,
              'binarySha256':digest(binary),'sidecarSha256':digest(sidecar),
              'inputSources':inputs,'tauriOverlaySha256':digest(build/'tauri-overlay.json'),
              'runtimeSources':{str(p.relative_to(ROOT)):digest(p) for p in sorted([
                  ROOT/'src-tauri/Cargo.toml',ROOT/'src-tauri/Cargo.lock',ROOT/'src-tauri/build.rs',
                  ROOT/'package-lock.json',*(ROOT/'src-tauri/src').rglob('*.rs'),
                  *(ROOT/'src-tauri/tests').glob('native-normal-journey.js'),
                  *(ROOT/'src-tauri/capabilities').glob('*.json')])},
              'boundaries':['test-only strict occupied-port refusal replaces normal pre-spawn reap',
                            'main from original WindowConfig instrumented with download/DOM hooks',
                            'incognito: no persistent WK pin/restart claim',
                            'synthetic File via DOM DataTransfer: no OS filepicker claim',
                            'no install/release/PRF/browser-autofill/protected-executor proof']}
    (output/'run.json').write_text(json.dumps(evidence,indent=2)+'\n')
    if not result['passed'] or not opaque: raise RuntimeError('native oracle failed; see private evidence')
    print(f'Actual normal WKWebView journey passed; private evidence: {output}')

if __name__=='__main__': main()
