#!/usr/bin/env python3
"""Build/run the opt-in real WKWebView ACL probe, without normal app setup.
No installs, services, sockets, user DB, browser profile or new dependency.
"""
import argparse
import hashlib
import sys
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True, help='private evidence directory')
parser.add_argument('--open-baseline', action='store_true', help='negative control: private source copy with original default-open app command policy')
parser.add_argument('--check-product', action='store_true', help='also compile ordinary startup and run synthetic Rust unit tests, without probe feature')
args = parser.parse_args()
if args.open_baseline and args.check_product:
    parser.error('baseline and ordinary product checks are separate runs')
if sys.platform != 'darwin':
    parser.error('this WKWebView probe requires macOS')
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
output.chmod(0o700)
env = {k: v for k, v in os.environ.items()
       if not k.startswith(('FOURALLPASS_', 'TAURI_'))}
with tempfile.TemporaryDirectory(prefix='4ap-native-acl-') as directory:
    private = Path(directory)
    private.chmod(0o700)
    dist = private / 'dist'
    dist.mkdir()
    for name in ['access-prompt.html', 'access-prompt.js']:
        shutil.copyfile(ROOT / 'frontend/public' / name, dist / name)
    (dist / 'index.html').write_text('<!doctype html><title>Private ACL probe</title>')
    overlay = {'productName':'4AllPass ACL Probe',
        'identifier':'de.netzwerkpunkt.fourallpass.acl-probe',
        'build':{'beforeDevCommand':None, 'beforeBuildCommand':None,
                 'devUrl':None, 'frontendDist':str(dist)},
        'app':{'windows':[]},
        'bundle':{'active':False, 'externalBin':[], 'resources':[]}}
    manifest_root = ROOT / 'src-tauri'
    if args.open_baseline:
        # No Git worktree and no edits to the candidate. Same handlers/fixture
        # safety; only the old absent AppManifest/shared capability policy.
        baseline = private / 'baseline'
        manifest_root = baseline / 'src-tauri'
        manifest_root.mkdir(parents=True)
        shutil.copyfile(ROOT/'LICENSE', baseline/'LICENSE')
        for name in ['Cargo.toml','Cargo.lock','Info.plist','entitlements.plist']:
            shutil.copyfile(ROOT/'src-tauri'/name, manifest_root/name)
        for name in ['src','tests','icons','capabilities']:
            shutil.copytree(ROOT/'src-tauri'/name, manifest_root/name)
        cfg = json.loads((ROOT/'src-tauri/tauri.conf.json').read_text())
        (manifest_root/'tauri.conf.json').write_text(json.dumps(cfg))
        (manifest_root/'build.rs').write_text('fn main() { tauri_build::build() }\n')
        default = json.loads((manifest_root/'capabilities/default.json').read_text())
        default['windows'] = ['main','access-prompt']
        default['permissions'] = [v for v in default['permissions'] if not v.startswith('allow-')]
        (manifest_root/'capabilities/default.json').write_text(json.dumps(default))
        prompt = json.loads((manifest_root/'capabilities/access-prompt.json').read_text())
        prompt['permissions'] = []
        (manifest_root/'capabilities/access-prompt.json').write_text(json.dumps(prompt))
    env['TAURI_CONFIG'] = json.dumps(overlay)
    env['CARGO_TARGET_DIR'] = str(ROOT / 'src-tauri/target')
    build = ['cargo','build','--locked','--manifest-path',str(manifest_root/'Cargo.toml'),
             '--features','native-acl-probe,custom-protocol','--bin','fourallpass-acl-probe','--jobs','2']
    with (output/'build.log').open('w') as log:
        result = subprocess.run(build,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
    if result.returncode:
        raise SystemExit(f'native build failed; see {output / "build.log"}')
    receipt = private/'native-result.json'
    binary = ROOT/'src-tauri/target/debug/fourallpass-acl-probe'
    with (output/'native.log').open('w') as log:
        result = subprocess.run([str(binary),str(receipt)],cwd=private,env=env,
                                stdout=log,stderr=subprocess.STDOUT,timeout=45)
    if receipt.exists():
        shutil.copyfile(receipt,output/'native-result.json')
    evidence = {'sourcePin':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
                'buildCommand':build,'nativeExitCode':result.returncode,
                'productionSetupCalled':False,'dependenciesAdded':False,
                'negativeControl':args.open_baseline,
                'compiledBuildScriptSha256':hashlib.sha256((manifest_root/'build.rs').read_bytes()).hexdigest(),
                'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),
                'privateDistRemovedOnExit':True,'incognito':True,
                'sourceDirty':bool(subprocess.check_output(['git','status','--porcelain=v1'],cwd=ROOT,text=True)),
                'sourceSha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in sorted([ROOT/'src-tauri/Cargo.toml', ROOT/'src-tauri/build.rs',
                                     ROOT/'src-tauri/tauri.conf.json', ROOT/'src-tauri/entitlements.plist',
                                     *(ROOT/'src-tauri/src').rglob('*.rs'),
                                     *(ROOT/'src-tauri/capabilities').glob('*.json')])}}
    (output/'run.json').write_text(json.dumps(evidence,indent=2)+'\n')
    for file in output.iterdir():
        if file.is_file():file.chmod(0o600)
    if args.check_product:
        unit = ['cargo','test','--locked','--manifest-path',str(ROOT/'src-tauri/Cargo.toml'),
                '--features','custom-protocol','--lib','--jobs','2']
        with (output/'product-unit-tests.log').open('w') as log:
            checked = subprocess.run(unit,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
        evidence['productUnitExitCode'] = checked.returncode
        (output/'run.json').write_text(json.dumps(evidence,indent=2)+'\n')
        if checked.returncode:
            raise SystemExit(f'ordinary-build unit tests failed; see {output}')
    expected = not args.open_baseline
    if not receipt.exists() or json.loads(receipt.read_text()).get('passed') is not expected:
        raise SystemExit(f'native ACL oracle did not match expected={expected}; see {output}')
    if result.returncode != (0 if expected else 1):
        raise SystemExit(f'native ACL exit status did not match oracle; see {output}')
for file in output.iterdir():
    if file.is_file():file.chmod(0o600)
print(f'Native WKWebView ACL oracle matched expected={not args.open_baseline}; evidence: {output}')
