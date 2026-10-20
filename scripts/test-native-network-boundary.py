#!/usr/bin/env python3
"""Real WKWebView CSP counterprobe extending the existing isolated H3 binary.

No normal startup, sidecar, production8788, account data or installed apps.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from native_network_fixture import Listener

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if sys.platform != 'darwin':
    parser.error('actual WKWebView probe requires macOS')
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
output.chmod(0o700)
config = json.loads((ROOT/'src-tauri/tauri.conf.json').read_text())
tight = config['app']['security']['csp']
local = "connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:8788"
assert local in tight, 'candidate must use the declared local profile'
wildcard = tight.replace(local, "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*")
env = {k:v for k,v in os.environ.items() if not k.startswith(('FOURALLPASS_', 'TAURI_'))}
env['CARGO_TARGET_DIR'] = str(ROOT/'src-tauri/target')
summaries = []
with tempfile.TemporaryDirectory(prefix='4ap-native-network-') as directory:
    private = Path(directory)
    private.chmod(0o700)
    dist = private/'dist'
    dist.mkdir()
    for name in ['access-prompt.html', 'access-prompt.js']:
        shutil.copyfile(ROOT/'frontend/public'/name, dist/name)
    (dist/'index.html').write_text('<!doctype html><title>Private network probe</title>')
    with Listener() as listener:
        for mode, policy in [('wildcard', wildcard), ('tight', tight)]:
            folder = output/mode
            folder.mkdir(mode=0o700)
            overlay = {'productName':'4AllPass Network Probe',
                'identifier':'de.netzwerkpunkt.fourallpass.acl-probe',
                'build':{'beforeDevCommand':None, 'beforeBuildCommand':None,
                    'devUrl':None, 'frontendDist':str(dist)},
                'app':{'windows':[], 'security':{'csp':policy}},
                'bundle':{'active':False, 'externalBin':[], 'resources':[]}}
            env['TAURI_CONFIG'] = json.dumps(overlay)
            build = ['cargo','build','--locked','--manifest-path',str(ROOT/'src-tauri/Cargo.toml'),
                '--features','native-network-probe,custom-protocol','--bin','fourallpass-acl-probe','--jobs','2']
            with (folder/'build.log').open('w') as log:
                built = subprocess.run(build, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            if built.returncode:
                raise SystemExit(f'native build failed: {folder}')
            before = len(listener.snapshot())
            receipt = private/f'{mode}.json'
            binary = ROOT/'src-tauri/target/debug/fourallpass-acl-probe'
            with (folder/'native.log').open('w') as log:
                result = subprocess.run([str(binary),str(receipt),str(listener.port),mode],
                    cwd=private, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=45)
            if not receipt.exists():
                raise SystemExit(f'native receipt missing: {folder}')
            data = json.loads(receipt.read_text())
            shutil.copyfile(receipt, folder/'native-result.json')
            requests = listener.snapshot()[before:]
            (folder/'listeners.json').write_text(json.dumps(requests,indent=2)+'\n')
            proof = {'mode':mode, 'csp':policy, 'nativeExitCode':result.returncode,
                'nativeOracle':data['passed'], 'ownedEphemeralPort':listener.port,
                'httpCount':sum(r['kind']=='http' for r in requests),
                'wsCount':sum(r['kind']=='ws' for r in requests),
                'aclRowsPassed':sum(r['passed'] for w in data['windows'].values() for r in w['rows']),
                'normalSetupCalled':data['normalSetupCalled'],
                'browserFixtureEmpty':data['browserFixtureEmpty'],
                'production8788Used':False, 'dependenciesAdded':False,
                'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest()}
            (folder/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
            summaries.append(proof)
            assert result.returncode==0 and data['passed'] and proof['aclRowsPassed']==33
            assert proof['httpCount']==proof['wsCount']==(3 if mode=='wildcard' else 0)
            assert all(not r['authorizationPresent'] and not r['cookiePresent'] for r in requests)
            assert not (private/'browser-fixture').exists()
sources = [ROOT/'src-tauri/Cargo.toml', ROOT/'src-tauri/Cargo.lock', ROOT/'src-tauri/build.rs',
    ROOT/'src-tauri/tauri.conf.json', *(ROOT/'src-tauri/src').glob('*.rs'),
    *(ROOT/'src-tauri/tests').glob('*.js'), *(ROOT/'src-tauri/capabilities').glob('*.json'),
    ROOT/'frontend/public/access-prompt.html', ROOT/'frontend/public/access-prompt.js',
    Path(__file__).resolve(), ROOT/'scripts/native_network_fixture.py']
(output/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(ROOT))+'\n' for p in sorted(sources)))
(output/'summary.json').write_text(json.dumps({'runs':summaries, 'sourceSha256File':'SHA256SUMS',
    'sourcePin':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    'sourceDirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True)),
    'listenerClosed':True, 'privateDistRemoved':True},indent=2)+'\n')
for path in output.rglob('*'):
    if path.is_file():path.chmod(0o600)
print(f'Actual WKWebView HTTP/WS CSP counterprobe passed in all three ACL contexts: {output}')
