import { ErrorTransformer } from "@algorandfoundation/algokit-utils/types/composer";
import { ErrorMessages } from "../generated/errors";

/**
 * Map of error codes to human-readable error messages
 */
export const errorMap: Record<string, string> = ErrorMessages;

export const errorTransformer: ErrorTransformer = async (ogError) => {
  const [errCode] = /ERR:[^" ]+/.exec(ogError.message) ?? [];
  if (errCode) {
    const humanMessage = errorMap[errCode] ?? "Unknown error";
    ogError.stack = `${errCode.replace("ERR:", "Error: ")}: ${humanMessage}\n    ${ogError.stack}`;
    (ogError as any).code = errCode;
    (ogError as any).humanMessage = humanMessage;
    return ogError;
  }
  return ogError;
};

export async function wrapErrorsInternal<T>(promiseOrGenerator: Promise<T> | (() => Promise<T>)): Promise<T> {
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

/**
 * Decorator that wraps the return value of an async method with error transformation.
 */
export function wrapErrors() {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return wrapErrorsInternal(() => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}
