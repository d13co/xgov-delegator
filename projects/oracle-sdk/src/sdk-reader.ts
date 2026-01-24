import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { getABIDecodedValue } from "@algorandfoundation/algokit-utils/types/app-arc56";
import { ALGORAND_ZERO_ADDRESS_STRING, encodeAddress, makeEmptyTransactionSigner } from "algosdk";
import pMap from "p-map";
import { CommitteeMetadata, CommitteeOracleClient, CommitteeOracleComposer, SuperboxMeta } from "./generated/CommitteeOracleClient";
import { getConstructorConfig } from "./networkConfig";
import { CommitteeId, Member, ReaderConstructorArgs, StoredMember, XGovCommitteeFile } from "./types";
import { chunk } from "./util/chunk";
import { chunked } from "./util/chunked";
import { committeeIdToRaw } from "./util/comitteeId";
import { errorTransformer } from "./util/wrapErrors";

export class XGovCommitteesOracleReaderSDK {
  public algorand: AlgorandClient;
  public appId: bigint;
  public readClient: CommitteeOracleClient;
  public concurrency: number;

  constructor({ algorand, concurrency = 4, ...rest }: ReaderConstructorArgs) {
    const { appId, readerAccount } = getConstructorConfig(rest);
    this.algorand = algorand;
    algorand.registerErrorTransformer(errorTransformer);
    this.appId = appId;
    this.concurrency = concurrency;
    this.readClient = new CommitteeOracleClient({
      algorand: this.algorand,
      appId: this.appId,
      defaultSender: readerAccount,
      defaultSigner: makeEmptyTransactionSigner(),
    });
  }

  async getCommittee(committeeId: CommitteeId): Promise<XGovCommitteeFile | null> {
    const committeeMetadata = await this.getCommitteeMetadata(committeeId);
    if (!committeeMetadata) return null;
    const members = await this.getCommitteeMembers(committeeId);
    return {
      periodEnd: committeeMetadata.periodEnd,
      periodStart: committeeMetadata.periodStart,
      totalMembers: committeeMetadata.totalMembers,
      totalVotes: committeeMetadata.totalVotes,
      xGovs: members.map(({ account, votes }) => ({ address: account.toString(), votes })),
    };
  }

  async getCommitteeMembers(committeeId: CommitteeId): Promise<Member[]> {
    const [members, accountMap] = await Promise.all([this.getCommitteeSuperboxData(committeeId), this.getAccountIdMap()]);
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

  async getCommitteeMetadata(committeeId: CommitteeId): Promise<CommitteeMetadata | null> {
    const { return: committeeMetadata } = await this.readClient.send.getCommitteeMetadata({
      args: { committeeId: committeeIdToRaw(committeeId) },
    });
    if (committeeMetadata!.periodEnd === 0) return null;
    return committeeMetadata!;
  }

  async getCommitteeSuperboxMeta(committeeId: CommitteeId): Promise<SuperboxMeta> {
    const { return: superboxMeta } = await this.readClient.send.getCommitteeSuperboxMeta({
      args: { committeeId: committeeIdToRaw(committeeId) },
    });
    return superboxMeta!;
  }

  async getCommitteeSuperboxData(committeeId: CommitteeId): Promise<StoredMember[]> {
    const [meta, commmitteeMetadata] = await Promise.all([
      this.getCommitteeSuperboxMeta(committeeId),
      this.getCommitteeMetadata(committeeId),
    ]);
    const numPages = Math.ceil(meta.boxByteLengths.length / 1000);
    const pages = Array.from({ length: numPages }, (_, i) => i);
    const pageData = await pMap(pages, (page) => this.superboxToStoredMembers(`${commmitteeMetadata?.superboxPrefix}${page}`), {
      concurrency: this.concurrency,
    });
    return pageData.flat();
  }

  protected async superboxToStoredMembers(superboxKey: string): Promise<StoredMember[]> {
    const bv = await this.algorand.app.getBoxValue(this.appId, superboxKey);
    const chunks = chunk(Array.from(bv!), 4 + 4); // each StoredMember is (uint32, uint32)
    return chunks.map((c) => getABIDecodedValue(new Uint8Array(c), "(uint32,uint32)", {}) as StoredMember);
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
    let builder: CommitteeOracleComposer<any> = this.readClient.newGroup();
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
