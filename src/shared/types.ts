export type Json =
  string | number | boolean | null | Json[] | { [key: string]: Json };
export interface ResponseData {
  code: number;
  body: Json;
}
export interface Identity {
  userId: string | null;
  caller: string;
  admin: boolean;
}
export interface Account {
  id: string;
  user_id: string | null;
  kind: string;
  balance: string;
}
export interface Transfer {
  id: string;
  source_account_id: string;
  destination_account_id: string;
  type: "topup" | "peer" | "withdrawal" | "fee" | "reversal";
  status: "held" | "posted" | "rejected" | "reversed";
  amount: string;
  note: string;
  original_transfer_id: string | null;
  created_at: Date;
}
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function first<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", 404, "Record not found");
  return row;
}
