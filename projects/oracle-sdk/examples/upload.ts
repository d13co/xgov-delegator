import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { XGovCommitteesOracleSDK, CommitteeOracleFactory, calculateCommitteeId } from "../src";
import { readFileSync } from "fs";

(async () => {
  const file = JSON.parse(readFileSync(process.argv[2], "utf-8"));

  const algorand = AlgorandClient.defaultLocalNet();
  const deployer = await algorand.account.fromEnvironment("DEPLOYER");

  const factory = algorand.client.getTypedAppFactory(CommitteeOracleFactory, {
    defaultSender: deployer.addr,
  });

  const { appId } = await factory.getAppClientByCreatorAndName({ creatorAddress: deployer.addr, appName: "CommitteeOracle" });

  console.log({ appId });
  const { balance } = await algorand.account.getInformation(deployer.addr);
  console.log("Deployer", deployer.addr.toString(), "balance:", balance.algos);

  const sdk = new XGovCommitteesOracleSDK({
    algorand,
    writerAccount: { sender: deployer.addr, signer: deployer.signer },
    oracleAppId: appId,
    debug: true,
  });

  await sdk.uploadCommitteeFile(file);
  const { minBalance } = await algorand.account.getInformation(sdk.writeClient!.appAddress);
  console.log({ appMinBalance: minBalance.algos });
})();
