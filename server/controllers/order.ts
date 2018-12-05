import db from "../models";
import { OrderInstance } from "../models/order";

export async function create(
  makerAsset: string,
  takerAsset: string,
  amount: number,
  filled: number,
  rate: number,
  makerAddress: string,
  signature: string,
  transaction: string,
  marketId: number
): Promise<OrderInstance> {
  return db.Order.create({
    makerAsset,
    takerAsset,
    amount,
    filled,
    rate,
    makerAddress,
    signature,
    transaction,
    marketId
  });
}

export async function find(
  makerAsset?: string,
  takerAsset?: string,
  amount?: number,
  filled?: number,
  rate?: number,
  makerAddress?: string,
  signature?: string,
  transaction?: string,
  marketId?: number
): Promise<OrderInstance[]> {
  let where = {
    makerAsset,
    takerAsset,
    amount,
    filled,
    rate,
    makerAddress,
    signature,
    transaction,
    marketId
  };
  for (const o in where) {
    if ((<any>where)[o] === null || (<any>where)[o] === undefined) {
      delete (<any>where)[o];
    }
  }
  console.log(where);
  return db.Order.findAll({
    where
  });
}

export async function destroy(id: number): Promise<void> {
  const order = await db.Order.findById(id);
  if (!order) {
    throw { message: "Order Not Found" };
  }
  return order.destroy();
}

export async function update(id: number, body: any): Promise<OrderInstance> {
  const order = await db.Order.findById(id);
  if (!order) {
    throw { message: "Order Not Found" };
  }
  return order.update(body, { fields: Object.keys(body) });
}