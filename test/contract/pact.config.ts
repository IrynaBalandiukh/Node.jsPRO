import * as path from 'node:path';

export const CONSUMER_NAME = 'marketplace-web';
export const PROVIDER_NAME = 'marketplace-api';

// <root>/pacts — і з test/contract (ts), і з dist-test/test/contract (js).
export const PACTS_DIR = path.resolve(__dirname, '..', '..', '..', 'pacts');

// Версія консюмера для публікації в брокер; у CI — SHA коміту.
export const CONSUMER_VERSION = process.env.CONSUMER_VERSION ?? '1.0.0';

// Версія провайдера має збігатися з тегом prod у брокері (can-i-deploy).
export const PROVIDER_VERSION = process.env.PROVIDER_VERSION ?? '1.0.0';
