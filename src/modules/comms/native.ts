import { browser } from 'webextension-polyfill-ts';
import { pipe } from 'fp-ts/lib/pipeable';
import * as T from 'fp-ts/lib/Task';
import * as TE from 'fp-ts/lib/TaskEither';
import * as E from 'fp-ts/lib/Either';
import { APP_NAME, MINIMUM_BINARY_VERSION } from 'Modules/config';
import { compareAgainstMinimum, SemanticVersioningComparison } from 'Modules/semantic-versioning';
import { RemoteBookmark, RemoteBookmarkUnsaved } from 'Modules/bookmarks';

type CheckBinaryRes =
	| { outdatedBinary: true }
	| { cannotFindBinary: true }
	| { unknownError: true };

interface GetBookmarksRes {
	bookmarksUpdated: true;
}

interface SaveBookmarkRes {
	bookmarkSaved: true;
}

interface UpdateBookmarkRes {
	bookmarkUpdated: true;
}

interface DeleteBookmarkRes {
	bookmarkDeleted: true;
}

export type NativeResponse =
	CheckBinaryRes | GetBookmarksRes | SaveBookmarkRes | UpdateBookmarkRes | DeleteBookmarkRes;

export enum NativeRequestMethod {
	GET = 'GET',
	OPTIONS = 'OPTIONS',
	POST = 'POST',
	PUT = 'PUT',
	DELETE = 'DELETE',
}

interface ErrResponse {
	success: false;
	message: string;
}

type NativeGETResponse = {
	success: true;
	bookmarks: RemoteBookmark[];
	moreAvailable: boolean;
} | ErrResponse;

interface NativeOPTIONSResponse {
	success: true;
	binaryVersion: string;
}

type NativePOSTResponse = { success: true; id: number } | { success: false };

interface NativePUTResponse {
	success: boolean;
}

interface NativeDELETEResponse {
	success: boolean;
}

export interface NativeRequestData {
	GET: { offset: number } | undefined;
	OPTIONS: undefined;
	POST: { bookmarks: RemoteBookmarkUnsaved[] };
	PUT: { bookmarks: RemoteBookmark[] };
	DELETE: { bookmark_ids: RemoteBookmark['id'][] };
}

export interface NativeRequestResult {
	GET: NativeGETResponse;
	OPTIONS: NativeOPTIONSResponse;
	POST: NativePOSTResponse;
	PUT: NativePUTResponse;
	DELETE: NativeDELETEResponse;
}

// TODO verify these payloads with io-ts
const sendMessageToNative = <T extends NativeRequestMethod>(method: T, data: NativeRequestData[T]): TaskEither<Error, NativeRequestResult[T]> =>
	TE.tryCatch(
		() => browser.runtime.sendNativeMessage(APP_NAME, { method, data }),
		(e) => new Error(`Failed to communicate with native messenger: ${e}`),
	);

export enum HostVersionCheckResult {
	Okay,
	HostOutdated,
	HostTooNew,
	NoComms,
	UnknownError,
}

const mapVersionCheckResult = (err: SemanticVersioningComparison): HostVersionCheckResult => {
	switch (err) {
		case SemanticVersioningComparison.BadVersions: return HostVersionCheckResult.UnknownError;
		case SemanticVersioningComparison.TestTooNew: return HostVersionCheckResult.HostTooNew;
		case SemanticVersioningComparison.TestOutdated: return HostVersionCheckResult.HostOutdated;
		case SemanticVersioningComparison.Okay: return HostVersionCheckResult.Okay;
	}
};

// Ensure binary version is equal to or newer than what we're expecting, but on
// the same major version (semantic versioning)
export const checkBinaryVersionFromNative: Task<HostVersionCheckResult> = pipe(
	sendMessageToNative(NativeRequestMethod.OPTIONS, undefined),
	T.map(E.fold(
		(e) => e.message.includes('host not found')
			? HostVersionCheckResult.NoComms
			: HostVersionCheckResult.UnknownError,
		(res) => !res.success || !res.binaryVersion
			? HostVersionCheckResult.UnknownError
			: mapVersionCheckResult(compareAgainstMinimum({ minimum: MINIMUM_BINARY_VERSION, test: res.binaryVersion })),
	)),
);

export const getBookmarksFromNative: TaskEither<Error, RemoteBookmark[]> = () => {
	// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
	const get = (prevBookmarks: RemoteBookmark[] = []): TaskEither<Error, RemoteBookmark[]> => async () => {
		const resM = await sendMessageToNative(NativeRequestMethod.GET, { offset: prevBookmarks.length })();
		if (E.isLeft(resM)) return E.left(resM.left);
		const res = resM.right;

		if (!res.success) return E.left(new Error('Success key is false.'));

		const bookmarks = [...prevBookmarks, ...res.bookmarks];
		return res.moreAvailable
			? get(bookmarks)()
			: E.right(bookmarks);
	};

	return get()();
};

export const saveBookmarksToNative = (bookmarks: RemoteBookmarkUnsaved[]): TaskEither<Error, NativePOSTResponse> =>
	sendMessageToNative(NativeRequestMethod.POST, { bookmarks });

export const updateBookmarksToNative = (bookmarks: RemoteBookmark[]): TaskEither<Error, NativePUTResponse> =>
	sendMessageToNative(NativeRequestMethod.PUT, { bookmarks });

export const deleteBookmarksFromNative = (bookmarkIds: RemoteBookmark['id'][]): TaskEither<Error, NativeDELETEResponse> =>
	// eslint-disable-next-line @typescript-eslint/camelcase
	sendMessageToNative(NativeRequestMethod.DELETE, { bookmark_ids: bookmarkIds });
