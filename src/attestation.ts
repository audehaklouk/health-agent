/**
 * Attestation info — what the public attestation page displays and verifies against.
 *
 * Inside the TEE, EigenCompute provides:
 *   - process.env.MNEMONIC                         (sealed, never leaves enclave)
 *   - process.env.APP_ID                           (also exposed via ecloud)
 *   - /usr/local/bin/kms-signing-public-key.pem    (KMS pubkey for signing attestations)
 *
 * The full hardware attestation is verified externally at:
 *   https://verify.eigencloud.xyz/app/<APP_ID>
 * (URL pattern based on docs; verify against current Eigen docs.)
 */
import { existsSync, readFileSync } from 'fs';

const KMS_PUBKEY_PATH = '/usr/local/bin/kms-signing-public-key.pem';

export interface AttestationInfo {
  insideTEE: boolean;
  appId: string | null;
  verifyUrl: string | null;
  kmsPublicKey: string | null;
  network: string;
  guarantees: string[];
  caveats: string[];
}

export async function getAttestationInfo(): Promise<AttestationInfo> {
  const insideTEE = Boolean(process.env.MNEMONIC) && existsSync(KMS_PUBKEY_PATH);
  const appId = process.env.APP_ID || null;

  return {
    insideTEE,
    appId,
    verifyUrl: appId ? `https://verify.eigencloud.xyz/app/${appId}` : null,
    kmsPublicKey:
      insideTEE && existsSync(KMS_PUBKEY_PATH)
        ? readFileSync(KMS_PUBKEY_PATH, 'utf8')
        : null,
    network: process.env.ECLOUD_ENV || (insideTEE ? 'mainnet-alpha' : 'local-dev'),
    guarantees: insideTEE
      ? [
          'Code running on this server is exactly the image registered on-chain.',
          'The operator (the developer of this app) cannot read user data in plaintext.',
          'The LLM provider does not see plaintext prompts or responses outside the TEE.',
          'Encryption keys are sealed by Intel TDX hardware and only available inside this enclave.',
        ]
      : [
          'NONE — this is a local dev instance.',
          'Run inside an EigenCompute TDX TEE on mainnet-alpha for cryptographic guarantees.',
        ],
    caveats: insideTEE
      ? [
          'Mainnet-alpha caveat: developers can still upgrade code (full upgrade-resistance ships in a later phase).',
          'Single KMS node operated by EigenLabs at this stage.',
          'No production SLA — this is a preview environment.',
        ]
      : ['Local dev — use only for testing.'],
  };
}
