import { LangfuseSpanProcessor } from '@langfuse/otel';
import { startActiveObservation } from '@langfuse/tracing';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { AppConfig } from '../config.js';
import type { Logger } from './logger.js';
import { safeTelemetryMetadata } from './redaction.js';

export interface ObservationOptions {
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly resultMetadata?: (result: unknown) => Readonly<Record<string, unknown>>;
}

export interface Telemetry {
  readonly enabled: boolean;
  observe<T>(name: string, options: ObservationOptions, operation: () => Promise<T>): Promise<T>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface ObservationSpan {
  update(attributes: {
    metadata?: Readonly<Record<string, unknown>>;
    output?: unknown;
    level?: 'ERROR';
    statusMessage?: string;
  }): unknown;
}

export type ObservationRunner = <T>(
  name: string,
  callback: (span: ObservationSpan) => Promise<T>,
) => Promise<T>;

class NoopTelemetry implements Telemetry {
  readonly enabled = false;
  observe<T>(_name: string, _options: ObservationOptions, operation: () => Promise<T>): Promise<T> {
    return operation();
  }
  flush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export class SafeLangfuseTelemetry implements Telemetry {
  readonly enabled = true;

  constructor(
    private readonly processor: Pick<LangfuseSpanProcessor, 'forceFlush'>,
    private readonly sdk: Pick<NodeSDK, 'shutdown'>,
    private readonly logger: Logger,
    private readonly runObservation: ObservationRunner = (name, callback) =>
      Promise.resolve(startActiveObservation(name, (span) => callback(span))),
  ) {}

  async observe<T>(
    name: string,
    options: ObservationOptions,
    operation: () => Promise<T>,
  ): Promise<T> {
    const state: {
      invoked: boolean;
      completed: boolean;
      result?: T;
      operationError?: Error;
    } = { invoked: false, completed: false };

    try {
      await this.runObservation(name, async (span) => {
        state.invoked = true;
        try {
          span.update({ metadata: safeTelemetryMetadata(options.metadata ?? {}) });
        } catch (error) {
          this.logger.warn('Langfuse metadata update failed.', { observation: name, error });
        }
        try {
          state.result = await operation();
          state.completed = true;
          try {
            span.update({
              output: safeTelemetryMetadata(
                options.resultMetadata?.(state.result) ?? { success: true },
              ),
            });
          } catch (error) {
            this.logger.warn('Langfuse result update failed.', { observation: name, error });
          }
          return state.result;
        } catch (error) {
          const operationError =
            error instanceof Error ? error : new Error('Operation failed.', { cause: error });
          state.operationError = operationError;
          try {
            span.update({
              level: 'ERROR',
              statusMessage: operationError.name,
              output: { success: false },
            });
          } catch (telemetryError) {
            this.logger.warn('Langfuse error update failed.', {
              observation: name,
              error: telemetryError,
            });
          }
          throw operationError;
        }
      });
    } catch (error) {
      if (state.operationError !== undefined) throw state.operationError;
      this.logger.warn('Langfuse observation failed without failing the operation.', {
        observation: name,
        error,
      });
      if (!state.invoked) return operation();
      if (state.completed) return state.result as T;
      throw error instanceof Error ? error : new Error('Telemetry failed.', { cause: error });
    }

    return state.result as T;
  }

  async flush(): Promise<void> {
    try {
      await this.processor.forceFlush();
    } catch (error) {
      this.logger.warn('Langfuse flush failed.', { error });
    }
  }

  async shutdown(): Promise<void> {
    await this.flush();
    try {
      await this.sdk.shutdown();
    } catch (error) {
      this.logger.warn('OpenTelemetry shutdown failed.', { error });
    }
  }
}

export function createTelemetry(config: AppConfig['langfuse'], logger: Logger): Telemetry {
  if (!config.enabled) return new NoopTelemetry();

  const processor = new LangfuseSpanProcessor({
    environment: config.environment,
    mediaUploadEnabled: false,
    mask: ({ data }) => safeTelemetryMetadata({ data }).data,
    ...(config.publicKey === undefined ? {} : { publicKey: config.publicKey }),
    ...(config.secretKey === undefined ? {} : { secretKey: config.secretKey }),
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
    ...(config.release === undefined ? {} : { release: config.release }),
  });
  const sdk = new NodeSDK({ spanProcessors: [processor] });
  sdk.start();
  return new SafeLangfuseTelemetry(processor, sdk, logger);
}
