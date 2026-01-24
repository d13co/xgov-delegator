import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { CommitteeMetadata, CommitteeOracleClient, CommitteeOracleComposer, SuperboxMeta } from "./generated/CommitteeOracleClient";
import { ALGORAND_ZERO_ADDRESS_STRING, decodeAddress, encodeAddress, makeEmptyTransactionSigner } from "algosdk";
import { chunked } from "./util/chunked";
import { chunk } from "./util/chunk";
import { getABIDecodedValue } from "@algorandfoundation/algokit-utils/types/app-arc56";
import { ConstructorArgs, Member, SenderWithSigner, StoredMember, XGovCommitteeFile } from "./types";
import { getConstructorConfig } from "./networkConfig";
import { requireSender } from "./util/requiresSender";
import { calculateCommitteeId } from "./util/calculateCommitteeId";
import { memberToTuple } from "./util/types";

export * from "./types";
export { calculateCommitteeId } from "./util/calculateCommitteeId";
export { CommitteeOracleFactory, CommitteeOracleClient } from "./generated/CommitteeOracleClient";

export class XGovCommitteesOracleSDK {
  public algorand: AlgorandClient;
  public appId: bigint;
  public client: CommitteeOracleClient;
  public concurrency: number;
  public sender?: SenderWithSigner;

  constructor({ algorand, sender, concurrency = 4, ...rest }: ConstructorArgs) {
    const { appId, readerAccount } = getConstructorConfig(rest);
    this.algorand = algorand;
    this.appId = appId;
    this.sender = sender;
    this.concurrency = concurrency;
    this.client = new CommitteeOracleClient({
      algorand: this.algorand,
      appId: this.appId,
      defaultSender: sender ? sender.sender : readerAccount,
      defaultSigner: sender ? sender.signer : makeEmptyTransactionSigner(),
    });
  }

  async uploadCommitteeFile(committeeFile: XGovCommitteeFile): Promise<void> {
    const committeeId = calculateCommitteeId(JSON.stringify(committeeFile));
    const committeeMetadata = await this.getCommitteeMetadata(committeeId);
    if (!committeeMetadata) {
      console.log("Registering committee...");
      const { txIds } = await this.registerCommittee({ committeeId, ...committeeFile });
      console.log("Committee registered ", ...txIds);
    }
    const accounts = committeeFile.xGovs.map(({ address }) => address);
    const accountIds = await this.getAccountIdMap(accounts);
    let accountsInOrder = [...accountIds.entries()]
      .map(([address, id]) => ({ address, id }))
      .sort(({ id: a}, {id: b}) => (a === 0 && b !== 0 ? 1 : (a !== 0 && b === 0 ? -1 : a - b) ));
    for (const { address, id } of accountsInOrder) {
      const votes = committeeFile.xGovs.find((x) => x.address === address)?.votes;
      console.log(`Account: ${address}, ID: ${id}, Votes: ${votes}`);
      if (!votes) {
        throw new Error(`No votes found for account ${address}`);
      }
      console.log(`Ingesting member with ID ${id} and votes ${votes}...`);
      const {
        txIds,
        confirmations: [{}],
      } = await this.ingestMembers(committeeId, [{ accountId: id, account: address, votes }]);
      console.log("Member ingested ", ...txIds);
    }
  }

  async getCommitteeMetadata(committeeId: Uint8Array): Promise<CommitteeMetadata | null> {
    const { return: committeeMetadata } = await this.client.send.getCommitteeMetadata({ args: { committeeId } });
    if (committeeMetadata!.periodEnd === 0) return null;
    return committeeMetadata!;
  }

  async getCommitteeSuperboxMeta(committeeId: Uint8Array): Promise<SuperboxMeta> {
    const { return: superboxMeta } = await this.client.send.getCommitteeSuperboxMeta({ args: { committeeId } });
    return superboxMeta!;
  }

  async getCommittee(committeeId: Uint8Array): Promise<XGovCommitteeFile | null> {
    const committeeMetadata = await this.getCommitteeMetadata(committeeId);
    if (!committeeMetadata) return null;
    const xGovs = await this.getCommitteeXGovs(committeeId);
    console.log({ totalVotes: committeeMetadata.totalVotes, ingestedVotes: committeeMetadata.ingestedVotes });
    return {
      periodEnd: committeeMetadata.periodEnd,
      periodStart: committeeMetadata.periodStart,
      totalMembers: committeeMetadata.totalMembers,
      totalVotes: committeeMetadata.totalVotes,
      xGovs: xGovs.map(({ account, votes }) => ({ address: account.toString(), votes })),
    };
  }

  async getCommitteeXGovs(committeeId: Uint8Array): Promise<Member[]> {
    const members: StoredMember[] = [];
    const meta = await this.getCommitteeSuperboxMeta(committeeId);
    const commmitteeMetadata = await this.getCommitteeMetadata(committeeId);
    const pages = Array.from({ length: Math.ceil(meta.boxByteLengths.length / 1000) }, (_, i) => i);
    for (const page of pages) {
      const bv = await this.algorand.app.getBoxValue(this.appId, `${commmitteeMetadata?.superboxPrefix}${page}`);
      const chunks = chunk(Array.from(bv!), 8); // each member is 12 bytes
      members.push(...chunks.map((c) => getABIDecodedValue(new Uint8Array(c), "(uint32,uint32)", {}) as StoredMember));
    }
    const accountMap = await this.getAccountIdMap();
    return members
      .map(([id, votes]) => {
        const accountRaw = Array.from(accountMap.entries()).find(([, accountId]) => accountId === id);
        const account = accountRaw ? accountRaw[0] : ALGORAND_ZERO_ADDRESS_STRING;
        return {
          accountId: id,
          account,
          votes,
        };
      })
      .sort((a, b) => (a < b ? -1 : 1));
  }

  @requireSender()
  makeRegisterCommitteeTxns({
    committeeId,
    periodStart,
    periodEnd,
    totalMembers,
    totalVotes,
  }: { committeeId: string | Uint8Array } & XGovCommitteeFile) {
    committeeId = typeof committeeId === "string" ? Buffer.from(committeeId, "base64") : committeeId;
    const { sender, signer } = this.sender!;
    return this.client.newGroup().registerCommittee({
      args: { committeeId, periodStart, periodEnd, totalMembers, totalVotes },
      sender,
      signer,
    });
  }

  async registerCommittee(...args: Parameters<typeof XGovCommitteesOracleSDK.prototype.makeRegisterCommitteeTxns>) {
    return this.makeRegisterCommitteeTxns(...args).send();
  }

  @requireSender()
  makeIngestMembersTxns(committeeId: string | Uint8Array, members: Member[]) {
    const { sender, signer } = this.sender!;
    committeeId = typeof committeeId === "string" ? Buffer.from(committeeId, "base64") : committeeId;
    return this.client.newGroup().ingestMembers({
      args: { committeeId, members: members.map(memberToTuple) },
      sender,
      signer,
    });
  }

  async ingestMembers(...args: Parameters<typeof XGovCommitteesOracleSDK.prototype.makeIngestMembersTxns>) {
    const builder = await this.makeIngestMembersTxns(...args);

    const {
      simulateResponse: {
        txnGroups: [{ appBudgetConsumed }],
      },
    } = await builder.simulate({ allowUnnamedResources: true });
    return builder.send();
  }

  async getAccounts(): Promise<string[]> {
    const boxNames = await this.algorand.app.getBoxNames(this.appId);
    return boxNames
      .filter(({ nameRaw }) => nameRaw[0] === 97 && nameRaw.length === 33)
      .map(({ nameRaw }) => {
        return encodeAddress(nameRaw.slice(1)).toString();
      });
  }

  async getAccountIdMap(accounts?: string[]): Promise<Map<string, number>> {
    accounts = accounts ?? (await this.getAccounts());
    const accountIds = await this._getAccountIdChunked(accounts);
    return new Map(accounts.map((account, index) => [account, accountIds[index]]));
  }

  @chunked(128)
  private async _getAccountIdChunked(accounts: string[]): Promise<number[]> {
    const retData: number[] = [];
    const retTypeStr = "uint32";
    const accountArgs = chunk(accounts, 63);
    let builder: CommitteeOracleComposer<any> = this.client.newGroup();
    for (const accountChunk of accountArgs) {
      builder = builder.logAccountIds({ args: { accounts: accountChunk } });
    }
    const { confirmations } = await builder.simulate({
      extraOpcodeBudget: 170_000,
      allowMoreLogging: true,
      allowEmptySignatures: true,
      allowUnnamedResources: true,
    });
    const logs = confirmations.flatMap(({ logs }) => logs);
    for (let i = 0; i < logs.length; i++) {
      retData.push(getABIDecodedValue(new Uint8Array(logs[i]!), retTypeStr, {}) as number);
    }
    return retData;
  }
}
