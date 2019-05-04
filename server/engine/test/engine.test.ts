import * as chai from "chai";
import { AssetAddress, H160 } from "codechain-primitives";
import { SDK } from "codechain-sdk";
import { Asset } from "codechain-sdk/lib/core/Asset";
import * as Config from "../../config/dex.json";
import { controllers } from "../../controllers";
import db from "../../models";
import { submit } from "../matching";

const expect = chai.expect;
const ASSET_ADDRESS = Config["dex-asset-address"];
const PLATFORM_ADDRESS = "tccq9h7vnl68frvqapzv3tujrxtxtwqdnxw6yamrrgd";
const PASSPHRASE = "satoshi";
const FEE_ASSET_TYPE = Config["fee-asset-type"];

describe("Order matching basic test", () => {
  let sdk: SDK;
  const shardId = 0;

  before(async function() {
    this.timeout(50000);
    sdk = new SDK({
      server: "http://127.0.0.1:8080",
      networkId: "tc"
    });

    const ACCOUNT_SECRET =
      process.env.ACCOUNT_SECRET ||
      "ede1d4ccb4ec9a8bbbae9a13db3f4a7b56ea04189be86ac3a6a439d9a0a1addd";
    const ACCOUNT_PASSPHRASE = process.env.ACCOUNT_PASSPHRASE || "satoshi";
    try {
      await sdk.rpc.account.importRaw(ACCOUNT_SECRET, ACCOUNT_PASSPHRASE);
    } catch (error) {
      if (error.message !== "Already Exists") {
        console.error(error);
      }
    }
  });

  let aliceAddress: AssetAddress;
  let bobAddress: AssetAddress;

  let gold: Asset;
  let silver: Asset;
  let wccc: Asset;

  beforeEach(async function() {
    this.timeout(50000);
    aliceAddress = await sdk.key.createAssetAddress({ type: "P2PKH" });
    bobAddress = await sdk.key.createAssetAddress({ type: "P2PKH" });

    // Mint gold asset for Alice
    const goldAssetScheme = sdk.core.createAssetScheme({
      shardId,
      metadata: {
        name: "Gold",
        description: "An asset example",
        icon_url: "https://gold.image/"
      },
      supply: 10000,
      registrar: null
    });
    const goldMintTx = sdk.core.createMintAssetTransaction({
      scheme: goldAssetScheme,
      recipient: aliceAddress
    });
    await sdk.rpc.chain.sendTransaction(goldMintTx, {
      account: PLATFORM_ADDRESS,
      passphrase: PASSPHRASE
    });
    const goldMintTxResults = await sdk.rpc.chain.getTransactionResultsByTracker(
      goldMintTx.tracker(),
      {
        timeout: 300 * 1000
      }
    );
    if (!goldMintTxResults[0]) {
      throw Error(
        `AssetMintTransaction failed: ${JSON.stringify(goldMintTxResults[0])}`
      );
    }
    gold = goldMintTx.getMintedAsset();

    // Mint silver asset for Bob
    const silverAssetScheme = sdk.core.createAssetScheme({
      shardId,
      metadata: {
        name: "Silver",
        description: "An asset example",
        icon_url: "https://silver.image/"
      },
      supply: 100000,
      registrar: null
    });
    const silverMintTx = sdk.core.createMintAssetTransaction({
      scheme: silverAssetScheme,
      recipient: bobAddress
    });
    await sdk.rpc.chain.sendTransaction(silverMintTx, {
      account: PLATFORM_ADDRESS,
      passphrase: PASSPHRASE
    });
    const silverMintTxResults = await sdk.rpc.chain.getTransactionResultsByTracker(
      silverMintTx.tracker(),
      {
        timeout: 300 * 1000
      }
    );
    if (!silverMintTxResults[0]) {
      throw Error(
        `AssetMintTransaction failed: ${JSON.stringify(silverMintTxResults[0])}`
      );
    }
    silver = silverMintTx.getMintedAsset();

    // Wrap 1000 CCC into the Wrapped CCC asset type and send to bob.
    const wrapCCC = sdk.core.createWrapCCCTransaction({
      shardId: 0,
      recipient: bobAddress,
      quantity: 1000,
      payer: PLATFORM_ADDRESS
    });
    const hash = await sdk.rpc.chain.sendTransaction(wrapCCC, {
      account: PLATFORM_ADDRESS,
      passphrase: PASSPHRASE
    });
    const result = await sdk.rpc.chain.containsTransaction(hash);
    expect(result).to.equal(true);
    wccc = wrapCCC.getAsset();
  });

  it("Complete fill matching", async () => {
    await (async () => {
      const goldInput = gold.createTransferInput();
      const silverInput = silver.createTransferInput();
      const wcccInput = wccc.createTransferInput();

      const expiration = Math.round(Date.now() / 1000) + 120;
      // Order for Alice
      const orderA = sdk.core.createOrder({
        assetTypeFrom: gold.assetType,
        assetTypeTo: silver.assetType,
        shardIdFrom: shardId,
        shardIdTo: shardId,
        assetQuantityFrom: 10,
        assetQuantityTo: 100,
        expiration,
        originOutputs: [goldInput.prevOut],
        recipientFrom: aliceAddress
      });
      await sdk.key.signTransactionInputWithOrder(goldInput, orderA);

      // Order for Bob
      const orderB = sdk.core.createOrder({
        assetTypeFrom: silver.assetType,
        assetTypeTo: gold.assetType,
        assetTypeFee: new H160(FEE_ASSET_TYPE),
        shardIdFrom: shardId,
        shardIdTo: shardId,
        shardIdFee: shardId,
        assetQuantityFrom: 100,
        assetQuantityTo: 10,
        assetQuantityFee: 100,
        expiration,
        originOutputs: [silverInput.prevOut, wcccInput.prevOut],
        recipientFrom: bobAddress,
        recipientFee: ASSET_ADDRESS
      });
      await sdk.key.signTransactionInputWithOrder(silverInput, orderB);
      await sdk.key.signTransactionInputWithOrder(wcccInput, orderB);

      await submit([goldInput], orderA, aliceAddress.toString(), null);
      await submit(
        [silverInput, wcccInput],
        orderB,
        bobAddress.toString(),
        null
      );

      const relayedOrder = await controllers.orderController.find(
        gold.assetType.toJSON(),
        silver.assetType.toJSON(),
        null,
        null,
        aliceAddress.toString()
      );
      expect(relayedOrder.length).to.equal(0);
    })().catch(async error => {
      console.error(`Error:`, error);
    });
  }).timeout(20000);

  it("No matching order", async () => {
    await (async () => {
      const goldInput = gold.createTransferInput();
      // Order is valid for 120 seconds
      const expiration = Math.round(Date.now() / 1000) + 120;
      const order = sdk.core.createOrder({
        assetTypeFrom: gold.assetType,
        assetTypeTo: new H160(FEE_ASSET_TYPE),
        shardIdFrom: shardId,
        shardIdTo: shardId,
        assetQuantityFrom: 10,
        assetQuantityTo: 100,
        expiration,
        originOutputs: [goldInput.prevOut],
        recipientFrom: aliceAddress
      });
      await sdk.key.signTransactionInputWithOrder(goldInput, order);

      await submit([goldInput], order, aliceAddress.toString(), null);

      const relayedOrder = await controllers.orderController.find(
        gold.assetType.toJSON(),
        FEE_ASSET_TYPE,
        null,
        null,
        aliceAddress.toString()
      );
      expect(relayedOrder.length).to.equal(1);
    })().catch(async error => {
      console.error(`Error:`, error);
    });
  }).timeout(20000);

  afterEach(async () => {
    await db.Order.destroy({
      where: {}
    });
  });

  after(async () => {
    await db.sequelize.close();
  });
});
