/* global globalThis */
const productionApiUrl = globalThis.process?.env?.SCHOOL_API_URL;

if (!__DEV__ && !productionApiUrl) {
	throw new Error('SCHOOL_API_URL must be configured for production builds.');
}

export const API_URL = __DEV__
	? 'http://192.168.1.26:4000'
	: productionApiUrl;
