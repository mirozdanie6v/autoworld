import test from 'node:test';
import assert from 'node:assert/strict';
import {sealPrivateKey,unsealPrivateKey} from '../scripts/awg-timeweb-ssh-keyring.mjs';

const privateKey='-----BEGIN OPENSSH PRIVATE KEY-----\nunit-test-only\n-----END OPENSSH PRIVATE KEY-----\n';
const publicKey='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIanexampletestkey fixture';
const passphrase='correct-horse-custom-random-'+'7P93M4BVZQ82RH6FCXKL';

test('Timeweb private SSH key is encrypted and can be decrypted only with the wrapping secret',()=>{
  const sealed=sealPrivateKey(privateKey,publicKey,passphrase);
  assert.equal(sealed.algorithm,'aes-256-gcm');
  assert.equal(sealed.publicKey,publicKey);
  assert.equal(JSON.stringify(sealed).includes('BEGIN OPENSSH PRIVATE KEY'),false);
  assert.equal(unsealPrivateKey(sealed,passphrase),privateKey);
  assert.throws(()=>unsealPrivateKey(sealed,'wrong-but-very-long-passphrase-unpredictable'),/authenticate|bad decrypt/i);
});

test('Timeweb SSH envelope rejects weak passphrase and tampering',()=>{
  assert.throws(()=>sealPrivateKey(privateKey,publicKey,'short'),/at least 32/);
  const sealed=sealPrivateKey(privateKey,publicKey,passphrase);
  assert.throws(()=>unsealPrivateKey({...sealed,publicKey:'ssh-ed25519 AAAABBBB swapped'},passphrase),/authenticate|bad decrypt/i);
  assert.throws(()=>unsealPrivateKey({...sealed,format:'unsupported'},passphrase),/Unsupported/);
  assert.throws(()=>unsealPrivateKey({...sealed,tag:'AAAA'},passphrase),/Malformed/);
});
