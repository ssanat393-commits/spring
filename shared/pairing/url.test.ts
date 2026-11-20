import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManualPairUrl,
  buildShortPairUrl,
  inspectPairingBaseUrl,
  normalizeBaseOrigin,
} from './url';

test('normalizeBaseOrigin strips paths and trailing slashes for http/https URLs', () => {
  assert.equal(
    normalizeBaseOrigin('https://ais-pre-demo.run.app/connect?foo=1'),
    'https://ais-pre-demo.run.app'
  );
  assert.equal(normalizeBaseOrigin('http://192.168.1.42:3000/'), 'http://192.168.1.42:3000');
  assert.equal(normalizeBaseOrigin('ftp://invalid.host'), null);
  assert.equal(normalizeBaseOrigin('not a url'), null);
});

test('inspectPairingBaseUrl flags ais-dev URLs as ais-dev-403 and ais-pre URLs as ready', () => {
  const devDiag = inspectPairingBaseUrl(
    'https://ais-dev-6g33hoob462gujvhyh2oge-484430936065.asia-east1.run.app'
  );
  assert.equal(devDiag.status, 'ais-dev-403');
  assert.equal(devDiag.isAiStudioDevPreview, true);

  const preDiag = inspectPairingBaseUrl(
    'https://ais-pre-6g33hoob462gujvhyh2oge-484430936065.asia-east1.run.app'
  );
  assert.equal(preDiag.status, 'ready');
  assert.equal(preDiag.isSharedAppPreview, true);

  const lanDiag = inspectPairingBaseUrl('http://192.168.1.50:3000');
  assert.equal(lanDiag.status, 'ready');
  assert.equal(lanDiag.isLocalhostOnly, false);

  const localDiag = inspectPairingBaseUrl('http://localhost:3000');
  assert.equal(localDiag.status, 'localhost-only');
  assert.equal(localDiag.isLocalhostOnly, true);
});

test('buildShortPairUrl and buildManualPairUrl normalize origin and short code', () => {
  assert.equal(
    buildShortPairUrl('https://ais-pre-demo.run.app/extra', ' cic-7x4m '),
    'https://ais-pre-demo.run.app/?c=CIC-7X4M'
  );
  assert.equal(
    buildManualPairUrl('https://ais-pre-demo.run.app/'),
    'https://ais-pre-demo.run.app/?pair=1'
  );
});
