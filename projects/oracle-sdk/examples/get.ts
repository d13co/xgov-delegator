import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { XGovCommitteesOracleSDK, CommitteeOracleFactory, calculateCommitteeId } from "../src";
import { readFileSync } from "fs";
import { writer } from "repl";

(async () => {
  const file = JSON.parse(readFileSync(process.argv[2], "utf-8"));

  const algorand = AlgorandClient.defaultLocalNet();
  const deployer = await algorand.account.fromEnvironment("DEPLOYER");

  const factory = algorand.client.getTypedAppFactory(CommitteeOracleFactory, {
    defaultSender: deployer.addr,
  });

  const { appId } = await factory.getAppClientByCreatorAndName({ creatorAddress: deployer.addr, appName: "CommitteeOracle" });

  console.log({ appId });

  const sdk = new XGovCommitteesOracleSDK({
    algorand,
    writerAccount: { sender: deployer.addr, signer: deployer.signer },
    oracleAppId: appId,
  });

  const id = calculateCommitteeId(JSON.stringify(file));
  console.log({ id: Buffer.from(id).toString("base64") });

  const comm = (await sdk.getCommittee(id))!;
  console.log(JSON.stringify(comm));
  if (comm) {
    for (const [key, value] of Object.entries(file)) {
      if (key === "xGovs") continue;
      if (value !== comm[key as keyof typeof comm]) {
        console.error(`Mismatch on ${key}: expected ${value}, got ${comm[key as keyof typeof comm]}`);
      }
    }
    const max = Math.max(file.xGovs.length, comm.xGovs.length);
    for (let i = 0; i < max; i++) {
      const expected = file.xGovs[i];
      const got = comm.xGovs[i];
      if (!expected) {
        console.error(`Extra xGov in stored committee: ${JSON.stringify(got)}`);
        continue;
      }
      if (!got) {
        console.error(`Missing xGov in stored committee: ${JSON.stringify(expected)}`);
        continue;
      }
      if (expected.address !== got.address || expected.votes !== got.votes) {
        console.error(`Mismatch on xGov index ${i}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
      }
    }
    console.log("Files match");
  }
  comm.networkGenesisHash = file.networkGenesisHash;
  const commId = calculateCommitteeId(JSON.stringify(comm));
  if (Buffer.from(commId).toString("base64") !== Buffer.from(id).toString("base64")) {
    console.error(`Recalculated committee ID mismatch: expected ${Buffer.from(id).toString("base64")}, got ${Buffer.from(commId).toString("base64")}`);
  } else {
    console.log("Committee ID matches on recalculation");
  }
})();
