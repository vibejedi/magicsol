import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";
import bs58 from "bs58";

const CARDS_MINT = "CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp";
const MAGIC_MINT = "47hdrCUp7XLsJDnYFDCMB687cqU48N3jiUjH7Gbapump";
const MAGIC_REQUIRED = 200_000;

function fileConfig() {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "data", "payout.json"), "utf8"));
  } catch {
    return {};
  }
}

export function payoutConfig() {
  const file = fileConfig();
  return {
    rpc: String(process.env.HELIUS_RPC_URL || file.rpc || "").trim(),
    secret: String(process.env.PAYOUT_SECRET_KEY || file.secret || "").trim(),
    cardsMint: String(process.env.CARDS_MINT || file.cardsMint || CARDS_MINT).trim(),
    magicMint: String(process.env.MAGIC_MINT || file.magicMint || MAGIC_MINT).trim(),
    magicRequired: Number(process.env.MAGIC_REQUIRED || file.magicRequired || MAGIC_REQUIRED),
  };
}

function connection() {
  const { rpc } = payoutConfig();
  if (!rpc) return null;
  return new Connection(rpc, "confirmed");
}

function treasury() {
  const { secret } = payoutConfig();
  if (!secret) return null;
  const bytes = bs58.decode(secret);
  return bytes.length === 64 ? Keypair.fromSecretKey(bytes) : Keypair.fromSeed(bytes);
}

export async function magicHolding(wallet) {
  const required = payoutConfig().magicRequired;
  const owner = String(wallet || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) {
    return { ok: false, allowed: false, amount: 0, required, error: "Sign in with a Solana wallet." };
  }
  const conn = connection();
  if (!conn) return { ok: false, allowed: false, amount: 0, required, error: "Solana is not configured on the server." };
  try {
    const mint = new PublicKey(payoutConfig().magicMint);
    const info = await conn.getAccountInfo(mint);
    if (!info) {
      return { ok: false, allowed: false, amount: 0, required, error: "$MAGIC mint was not found on Solana." };
    }
    const accounts = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint });
    const amount = accounts.value.reduce((sum, account) => {
      const ui = account.account.data.parsed.info.tokenAmount.uiAmount;
      return sum + (Number(ui) || 0);
    }, 0);
    return { ok: true, allowed: amount >= required, amount, required };
  } catch {
    return { ok: false, allowed: false, amount: 0, required, error: "Could not read the $MAGIC balance." };
  }
}

export async function payCards({ to, uiAmount }) {
  const conn = connection();
  const payer = treasury();
  const amount = Number(uiAmount);
  if (!conn || !payer) return { ok: false, error: "Payout wallet is not configured on the server." };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Nothing to pay." };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(to || ""))) return { ok: false, error: "Bad payout wallet." };
  try {
    const mint = new PublicKey(payoutConfig().cardsMint);
    const dest = new PublicKey(to);
    const mintInfo = await getMint(conn, mint);
    const raw = BigInt(Math.round(amount * 10 ** mintInfo.decimals));
    const source = await getAssociatedTokenAddress(mint, payer.publicKey);
    const sourceInfo = await conn.getTokenAccountBalance(source).catch(() => null);
    const have = BigInt(sourceInfo && sourceInfo.value ? sourceInfo.value.amount : "0");
    if (have < raw) return { ok: false, error: "The payout wallet has no $CARDS to send." };
    const destination = await getAssociatedTokenAddress(mint, dest);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, destination, dest, mint),
      createTransferInstruction(source, destination, payer.publicKey, raw),
    );
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(payer);
    const signature = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(signature, "confirmed");
    return { ok: true, signature };
  } catch {
    return { ok: false, error: "The $CARDS transfer did not send." };
  }
}
