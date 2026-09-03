import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, open, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type BootstrapOptions = Readonly<{
  kid: string;
  privateKeyPath: string;
  publicKeyringPath: string;
  forbiddenRoot?: string;
}>;

type PublicEd25519Jwk = Readonly<{
  crv: "Ed25519";
  kty: "OKP";
  x: string;
}>;

type BootstrapResult = Readonly<{
  kid: string;
  publicJwkThumbprint: string;
  publicKeyringPath: string;
}>;

const KID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

function requireKid(value: string): string {
  const kid = value.trim();
  if (!KID_PATTERN.test(kid)) {
    throw new Error("AIRenOS session key id must be 3-128 characters using letters, digits, dot, underscore, colon or hyphen");
  }
  return kid;
}

function publicEd25519Jwk(value: JsonWebKey): PublicEd25519Jwk {
  if (value.kty !== "OKP" || value.crv !== "Ed25519" || typeof value.x !== "string" || !value.x || value.d) {
    throw new Error("Generated AIRenOS public key must be an Ed25519 public-only JWK");
  }
  return Object.freeze({ crv: "Ed25519", kty: "OKP", x: value.x });
}

export function airenOSSessionPublicJwkThumbprint(value: JsonWebKey): string {
  const jwk = publicEd25519Jwk(value);
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return createHash("sha256").update(canonical, "utf8").digest("base64url");
}

function assertOutsideForbiddenRoot(targetPath: string, forbiddenRoot: string): void {
  const root = resolve(forbiddenRoot);
  const target = resolve(targetPath);
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error("AIRenOS live session signing material must not be written inside the repository/worktree");
  }
}

async function writeExclusive(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, "wx", mode);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function bootstrapAirenOSSessionSigningKey(options: BootstrapOptions): Promise<BootstrapResult> {
  const kid = requireKid(options.kid);
  const privateKeyPath = resolve(options.privateKeyPath);
  const publicKeyringPath = resolve(options.publicKeyringPath);
  const forbiddenRoot = resolve(options.forbiddenRoot ?? process.cwd());

  if (privateKeyPath === publicKeyringPath) {
    throw new Error("AIRenOS private key and public keyring paths must be different");
  }
  assertOutsideForbiddenRoot(privateKeyPath, forbiddenRoot);
  assertOutsideForbiddenRoot(publicKeyringPath, forbiddenRoot);

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicEd25519Jwk(publicKey.export({ format: "jwk" }));
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeyring = `${JSON.stringify({ [kid]: { key: publicJwk, enabled: true } }, null, 2)}\n`;

  await writeExclusive(privateKeyPath, privatePem, 0o600);
  try {
    await writeExclusive(publicKeyringPath, publicKeyring, 0o600);
  } catch (error) {
    await rm(privateKeyPath, { force: true });
    throw error;
  }

  const privateMode = (await stat(privateKeyPath)).mode & 0o777;
  const publicMode = (await stat(publicKeyringPath)).mode & 0o777;
  if (privateMode !== 0o600 || publicMode !== 0o600) {
    await Promise.all([
      rm(privateKeyPath, { force: true }),
      rm(publicKeyringPath, { force: true }),
    ]);
    throw new Error("AIRenOS session signing key bootstrap requires mode 0600 for generated material");
  }

  return Object.freeze({
    kid,
    publicJwkThumbprint: airenOSSessionPublicJwkThumbprint(publicJwk),
    publicKeyringPath,
  });
}

function requiredCliValue(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing required ${name} value`);
  return value;
}

async function main(): Promise<void> {
  const result = await bootstrapAirenOSSessionSigningKey({
    kid: requiredCliValue("--kid"),
    privateKeyPath: requiredCliValue("--private-key-out"),
    publicKeyringPath: requiredCliValue("--public-keyring-out"),
  });
  process.stdout.write(`${JSON.stringify({
    event: "airenos.session_signing_key.bootstrap_complete",
    kid: result.kid,
    publicJwkThumbprint: result.publicJwkThumbprint,
    publicKeyringPath: result.publicKeyringPath,
    privateKeyMaterialEmitted: false,
  })}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath && import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    process.stderr.write(`${JSON.stringify({ event: "airenos.session_signing_key.bootstrap_failed", error: message })}\n`);
    process.exitCode = 1;
  });
}
