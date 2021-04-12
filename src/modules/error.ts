import * as t from 'io-ts';

export const error = (x: string): Error => new Error(x);

export const isError: Refinement<unknown, Error> = (x): x is Error => x instanceof Error;

export const asError = (x: unknown): Error => isError(x)
	? x
	: t.string.is(x)
		? error(x)
		: typeof x === 'object' && x !== null
			? error(x.toString())
			: error('An unparseable error occurred');

