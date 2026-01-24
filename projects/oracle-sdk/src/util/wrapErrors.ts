import { ErrorTransformer } from "@algorandfoundation/algokit-utils/types/composer";

export const errorTransformer: ErrorTransformer = async (ogError) => {
  const [errCode] = /ERR:[^" ]+/.exec(ogError.message) ?? [];
  if (errCode) {
    ogError.stack = `Error Code: ${errCode}\n\t${ogError.stack}`;
    return ogError;
  }
  return ogError;
};

export async function wrapErrors<T>(promiseOrGenerator: Promise<T> | (() => Promise<T>)): Promise<T> {
  try {
    if (typeof promiseOrGenerator === "function") {
      return await promiseOrGenerator();
    } else {
      return await promiseOrGenerator;
    }
  } catch (e) {
    throw await errorTransformer(e as Error);
  }
}
