import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { Account, Address, TransactionSigner } from "algosdk";

export type Network = "mainnet" | "testnet";

export type ConstructorArgsOptions =
  | {
      network: Network;
    }
  | {
      oracleAppId: number | bigint;
      readerAccount?: string;
    };

export type SenderWithSigner = {
  sender: Address | string;
  signer: TransactionSigner;
};

export type ConstructorArgs = {
  algorand: AlgorandClient;
  concurrency?: number;
  sender?: SenderWithSigner;
} & ConstructorArgsOptions;

export interface XGovCommitteeFile {
  xGovs: Array<{
    address: string;
    votes: number;
  }>;
  periodStart: number;
  periodEnd: number;
  totalMembers: number;
  totalVotes: number;
}

export type Member = {
  accountId: number
  account: Address | string
  votes: number
}

type ID = number
type Votes = number
export type StoredMember = [ID, Votes]
