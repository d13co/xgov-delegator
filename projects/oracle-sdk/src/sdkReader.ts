import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { getABIDecodedValue } from "@algorandfoundation/algokit-utils/types/app-arc56";
import { ALGORAND_ZERO_ADDRESS_STRING, encodeAddress, makeEmptyTransactionSigner } from "algosdk";
import pMap from "p-map";
import { CommitteeMetadata, CommitteeOracleClient, CommitteeOracleComposer, SuperboxMeta } from "./generated/CommitteeOracleClient";
import { getConstructorConfig } from "./networkConfig";
import { CommitteeId, XGov, ReaderConstructorArgs, STORED_XGOV_BYTE_LENGTH, StoredXGov, XGovCommitteeFile } from "./types";
import { chunk } from "./util/chunk";
import { chunked } from "./util/chunked";
import { committeeIdToRaw } from "./util/comitteeId";
import { errorTransformer, wrapErrors } from "./util/wrapErrors";

export class XGovCommitteesOracleReaderSDK {
  public algorand: AlgorandClient;
  public appId: bigint;
  public readClient: CommitteeOracleClient;
  public concurrency: number;
  public debug?: boolean;

  constructor({ algorand, concurrency = 4, debug, ...rest }: ReaderConstructorArgs) {
    const { appId, readerAccount } = getConstructorConfig(rest);
    this.algorand = algorand;
    algorand.setSuggestedParamsCacheTimeout(6000) // 6s or ~2 rounds of cache. reduces GET requests to /params
    algorand.registerErrorTransformer(errorTransformer);
    this.appId = appId;
    this.concurrency = concurrency;
    this.debug = debug;
    this.readClient = new CommitteeOracleClient({
      algorand: this.algorand,
      appId: this.appId,
      defaultSender: readerAccount,
      defaultSigner: makeEmptyTransactionSigner(),
    });
  }

  @wrapErrors()
  async getCommittee(committeeId: CommitteeId): Promise<XGovCommitteeFile | null> {
    const committeeMetadata = await this.getCommitteeMetadata(committeeId, true);
    if (!committeeMetadata) return null;
    const xGovs = await this.getCommitteeXGovs(committeeId);
    const params = await this.algorand.getSuggestedParams()
    const networkGenesisHash = Buffer.from(params.genesisHash!).toString("base64");
    return {
      networkGenesisHash,
      periodEnd: committeeMetadata.periodEnd,
      periodStart: committeeMetadata.periodStart,
      registryId: Number(committeeMetadata.xGovRegistryId),
      totalMembers: committeeMetadata.totalMembers,
      totalVotes: committeeMetadata.totalVotes,
      xGovs: xGovs.map(({ account, votes }) => ({ address: account.toString(), votes })),
    };
  }

  async getCommitteeXGovs(committeeId: CommitteeId): Promise<XGov[]> {
    const [xGovs, accountMap] = await Promise.all([this.getCommitteeSuperboxData(committeeId), this.getAccountIdMap()]);
    return xGovs
      .map(([id, votes]) => {
        const accountRaw = Array.from(accountMap.entries()).find(([, accountId]) => accountId === id);
        const account = accountRaw ? accountRaw[0] : ALGORAND_ZERO_ADDRESS_STRING;
        return {
          accountId: id,
          account,
          votes,
        };
      })
      .sort((a, b) => (a.account < b.account ? -1 : 1));
  }

  async getCommitteeMetadata(committeeId: CommitteeId, mustBeComplete: boolean = false): Promise<CommitteeMetadata | null> {
    const { return: committeeMetadata } = await this.readClient.send.getCommitteeMetadata({
      args: { committeeId: committeeIdToRaw(committeeId), mustBeComplete },
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

  async getCommitteeSuperboxData(committeeId: CommitteeId): Promise<StoredXGov[]> {
    const [meta, commmitteeMetadata] = await Promise.all([
      this.getCommitteeSuperboxMeta(committeeId),
      this.getCommitteeMetadata(committeeId),
    ]);
    const numPages = Math.ceil(Number(meta.totalByteLength) / Number(meta.maxBoxSize));
    const pages = Array.from({ length: numPages }, (_, i) => i);
    const pageData = await pMap(pages, (page) => this.superboxToStoredXGovs(`${commmitteeMetadata?.superboxPrefix}${page}`), {
      concurrency: this.concurrency,
    });
    return pageData.flat();
  }

  async getCommitteeSuperboxDataLast(committeeId: CommitteeId): Promise<{ last?: StoredXGov; total: number }> {
    const [meta, commmitteeMetadata] = await Promise.all([
      this.getCommitteeSuperboxMeta(committeeId),
      this.getCommitteeMetadata(committeeId),
    ]);
    const numXGovs = Math.ceil(Number(meta.totalByteLength) / Number(meta.valueSize));
    if (numXGovs === 0) {
      return { total: 0 };
    }
    const numPages = Math.ceil(Number(meta.totalByteLength) / Number(meta.maxBoxSize));
    const superboxKey = `${commmitteeMetadata?.superboxPrefix}${numPages - 1}`;
    const lastPage = await this.superboxToStoredXGovs(superboxKey);
    return { last: lastPage[lastPage.length - 1], total: numXGovs };
  }

  protected async superboxToStoredXGovs(superboxKey: string): Promise<StoredXGov[]> {
    const bv = await this.algorand.app.getBoxValue(this.appId, superboxKey);
    const chunks = chunk(Array.from(bv!), STORED_XGOV_BYTE_LENGTH); // each StoredXGov is (uint32, uint32)
    return chunks.map((c) => getABIDecodedValue(new Uint8Array(c), "(uint32,uint32)", {}) as StoredXGov);
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
