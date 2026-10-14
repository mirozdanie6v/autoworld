import {createCipheriv,createDecipheriv,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const format='awg-timeweb-ed25519-v1';
const kdfParams={N:65536,r:8,p:1,maxmem:128*1024*1024};
const b64=value=>Buffer.from(value).toString('base64');
const from64=value=>Buffer.from(value,'base64');

function secret(passphrase){
  if(typeof passphrase!=='string'||passphrase.length<32)throw new Error('AWG_SSH_KEY_WRAP_PASSPHRASE must be at least 32 unpredictable characters');
  return passphrase;
}
function validatePublic(publicKey){
  if(!/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]*)?$/.test(publicKey)||publicKey.includes('\n')){
    throw new Error('Ed25519 public key required');
  }
  return publicKey.trim();
}
function aad(publicKey){return Buffer.from(format+'\n'+publicKey,'utf8')}

export function sealPrivateKey(privateKey,publicKey,passphrase){
  secret(passphrase);
  const pub=validatePublic(publicKey);
  if(!String(privateKey).startsWith('-----BEGIN OPENSSH PRIVATE KEY-----\n')){
    throw new Error('Expected an OpenSSH private key');
  }
  const salt=randomBytes(16),nonce=randomBytes(12);
  const derived=scryptSync(passphrase,salt,32,kdfParams);
  try{
    const cipher=createCipheriv('aes-256-gcm',derived,nonce);
    cipher.setAAD(aad(pub));
    const ciphertext=Buffer.concat([cipher.update(String(privateKey),'utf8'),cipher.final()]);
    return {format,algorithm:'aes-256-gcm',kdf:'scrypt',N:kdfParams.N,r:kdfParams.r,p:kdfParams.p,
      publicKey:pub,salt:b64(salt),nonce:b64(nonce),ciphertext:b64(ciphertext),tag:b64(cipher.getAuthTag())};
  }finally{derived.fill(0)}
}

export function unsealPrivateKey(envelope,passphrase){
  secret(passphrase);
  if(envelope?.format!==format||envelope.algorithm!=='aes-256-gcm'||envelope.kdf!=='scrypt'||
    envelope.N!==kdfParams.N||envelope.r!==kdfParams.r||envelope.p!==kdfParams.p){
    throw new Error('Unsupported SSH key envelope');
  }
  const pub=validatePublic(envelope.publicKey);
  const salt=from64(envelope.salt),nonce=from64(envelope.nonce),tag=from64(envelope.tag);
  if(salt.length!==16||nonce.length!==12||tag.length!==16)throw new Error('Malformed SSH key envelope');
  const derived=scryptSync(passphrase,salt,32,kdfParams);
  try{
    const decipher=createDecipheriv('aes-256-gcm',derived,nonce);
    decipher.setAAD(aad(pub));
    decipher.setAuthTag(tag);
    const data=Buffer.concat([decipher.update(from64(envelope.ciphertext)),decipher.final()]).toString('utf8');
    if(!data.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----\n'))throw new Error('Decrypted key is not OpenSSH format');
    return data;
  }finally{derived.fill(0)}
}

async function validatePair(privateKey,publicKey){
  const dir=await mkdtemp(path.join(tmpdir(),'awg-ssh-verify-'));
  const keyFile=path.join(dir,'id_ed25519');
  try{
    await writeFile(keyFile,privateKey,{mode:0o600,flag:'wx'});
    const derivedPub=execFileSync('ssh-keygen',['-y','-f',keyFile],{encoding:'utf8'}).trim();
    const expected=validatePublic(publicKey).split(/\s+/);
    const actual=derivedPub.split(/\s+/);
    if(expected[0]!==actual[0]||expected[1]!==actual[1])throw new Error('SSH private/public mismatch');
  }finally{await rm(dir,{recursive:true,force:true})}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [command,input,other,output]=process.argv.slice(2);
  const passphrase=secret(process.env.AWG_SSH_KEY_WRAP_PASSPHRASE);
  if(command==='seal'){
    if(!input||!other||!output)throw new Error('Usage: seal PRIVATE_KEY PUBLIC_KEY ENCRYPTED_JSON');
    const key=await readFile(input,'utf8'),pub=(await readFile(other,'utf8')).trim();
    const envelope=sealPrivateKey(key,pub,passphrase);
    await validatePair(unsealPrivateKey(envelope,passphrase),pub);
    await writeFile(output,JSON.stringify(envelope,null,2)+'\n',{mode:0o600,flag:'wx'});
    console.log('AWG_SSH_PRIVATE_KEY_ENCRYPTED_AND_VERIFIED');
  }else if(command==='verify'){
    if(!input)throw new Error('Usage: verify ENCRYPTED_JSON');
    const envelope=JSON.parse(await readFile(input,'utf8'));
    await validatePair(unsealPrivateKey(envelope,passphrase),envelope.publicKey);
    console.log('AWG_SSH_KEY_DECRYPT_AND_PAIR_VERIFICATION_PASS');
  }else if(command==='open'){
    if(!input||!other)throw new Error('Usage: open ENCRYPTED_JSON OUTPUT_PRIVATE_KEY');
    const envelope=JSON.parse(await readFile(input,'utf8'));
    const privateKey=unsealPrivateKey(envelope,passphrase);
    await validatePair(privateKey,envelope.publicKey);
    await writeFile(other,privateKey,{mode:0o600,flag:'wx'});
    console.log('AWG_SSH_PRIVATE_KEY_OPENED_TO_SECURE_TEMP_FILE');
  }else throw new Error('Unsupported mode: seal, verify or open');
}
