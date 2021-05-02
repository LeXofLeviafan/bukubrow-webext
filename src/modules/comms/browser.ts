import { pipe } from "fp-ts/lib/pipeable"
import { flow, constant, constFalse, constVoid } from "fp-ts/lib/function"
import { sequenceT } from "fp-ts/lib/Apply"
import * as O from "fp-ts/lib/Option"
import * as T from "fp-ts/lib/Task"
import * as TO from "fp-ts-contrib/lib/TaskOption"
import * as TE from "fp-ts/lib/TaskEither"
import * as A from "fp-ts/lib/Array"
import * as NEA from "fp-ts/lib/NonEmptyArray"
import { browser, Tabs } from "webextension-polyfill-ts"
import { BOOKMARKS_SCHEMA_VERSION } from "~/modules/config"
import { runIO } from "~/modules/fp"
import {
  sendIsomorphicMessage,
  IsomorphicMessage,
} from "~/modules/comms/isomorphic"
import { createUuid } from "~/modules/uuid"
import { error } from "~/modules/error"
import { LocalBookmark, LocalBookmarkUnsaved } from "~/modules/bookmarks"
import { StagedBookmarksGroup } from "~/modules/staged-groups"
import { BookmarkletCode, unBookmarkletCode } from "~/modules/bookmarklet"

const sequenceTTE = sequenceT(TE.taskEither)

export const openPopup: IO<void> = () => {
  browser.browserAction.openPopup().catch(constVoid)
}

export const closePopup: IO<void> = () => {
  window.close()
}

/**
 * As of time of writing there's no use for this function in production, but
 * calling it in dev can allow you to reset local storage and experience the
 * WebExtension as a new user would; there doesn't appear to be any clean way
 * of doing this within the browse either as a user or a dev.
 */
export const wipeLocalStorage: Task<void> = browser.storage.local.clear

const browserTabsQuery = (
  x: Tabs.QueryQueryInfoType,
): TaskOption<Array<Tabs.Tab>> => TO.tryCatch(() => browser.tabs.query(x))

export const getActiveTab: TaskOption<Tabs.Tab> = pipe(
  browserTabsQuery({ active: true, currentWindow: true }),
  TO.chainOption(A.head),
)

export const getActiveWindowTabs: TaskOption<NonEmptyArray<Tabs.Tab>> = pipe(
  browserTabsQuery({ currentWindow: true }),
  TO.chainOption(NEA.fromArray),
)

export const getAllTabs: TaskOption<NonEmptyArray<Tabs.Tab>> = pipe(
  browserTabsQuery({}),
  TO.chainOption(NEA.fromArray),
)

export const onTabActivity = (cb: Lazy<void>): void => {
  browser.tabs.onActivated.addListener(cb)
  browser.tabs.onUpdated.addListener(cb)
}

// The imperfect title includes check is because Firefox's href changes
// according to the extension in use, if any
const isNewTabPage: Predicate<Pick<Tabs.Tab, "url" | "title">> = ({
  url = "",
  title = "",
}) =>
  ["about:blank", "chrome://newtab/"].includes(url) || title.includes("New Tab")

/// The active tab will not update quickly enough to allow this function to be
/// called safely in a loop. Therefore, the second argument forces consumers to
/// verify that this is only the first tab they're opening.
export const openBookmarkInAppropriateTab = (isFirstTab: boolean) => (
  url: string,
): Task<Tabs.Tab> =>
  pipe(
    getActiveTab,
    T.map(O.fold(constFalse, isNewTabPage)),
    T.chain(canOpenInCurrentTab => (): Promise<Tabs.Tab> =>
      canOpenInCurrentTab && isFirstTab
        ? browser.tabs.update(undefined, { url })
        : browser.tabs.create({ url }),
    ),
  )

export const executeCodeInActiveTab = (
  x: BookmarkletCode,
): TaskEither<Error, void> =>
  TE.tryCatch(
    () =>
      browser.tabs
        .executeScript({ code: unBookmarkletCode(x) })
        .then(constVoid),
    constant(new Error("Failed to execute code in active tab")),
  )

export interface StorageState {
  bookmarks: Array<LocalBookmark>
  stagedBookmarksGroups: Array<StagedBookmarksGroup>
  bookmarksSchemaVersion: number
}

// TODO actually verify the return type with io-ts
const getLocalStorage = <T extends keyof StorageState>(
  ...ks: Array<T>
): TaskEither<Error, Partial<Pick<StorageState, T>>> =>
  TE.tryCatch(
    () =>
      browser.storage.local.get(ks) as Promise<Partial<Pick<StorageState, T>>>,
    constant(new Error("Failed to get local storage")),
  )

const setLocalStorage = (x: Partial<StorageState>): TaskEither<Error, void> =>
  TE.tryCatch(
    () => browser.storage.local.set(x),
    constant(new Error("Failed to set local storage")),
  )

export const getBookmarksFromLocalStorage: TaskEither<
  Error,
  Option<NonEmptyArray<LocalBookmark>>
> = pipe(
  getLocalStorage("bookmarks", "bookmarksSchemaVersion"),
  // Once upon a time we tried to store tags as a Set. Chrome's extension
  // storage implementation didn't like this, but Firefox did. The change was
  // reverted, but now the tags are sometimes still stored as a set. For some
  // reason. This addresses that by ensuring any tags pulled from storage will
  // be resolved as an array, regardless of whether they're stored as an array
  // or a Set.
  TE.chain(
    TE.fromPredicate(
      d => d.bookmarksSchemaVersion === BOOKMARKS_SCHEMA_VERSION,
      constant(error("Bookmark schema versions don't match")),
    ),
  ),
  TE.map(
    flow(
      d => O.fromNullable(d.bookmarks),
      O.chain(NEA.fromArray),
      O.map(
        NEA.map(bm => ({
          ...bm,
          tags: Array.from(bm.tags),
        })),
      ),
    ),
  ),
)

export const getBookmarksFromLocalStorageInfallible: Task<
  Array<LocalBookmark>
> = pipe(
  getBookmarksFromLocalStorage,
  TE.map(O.getOrElse(constant<Array<LocalBookmark>>(A.empty))),
  TE.getOrElse(constant(T.of<Array<LocalBookmark>>(A.empty))),
)

export const saveBookmarksToLocalStorage = (
  bookmarks: Array<LocalBookmark>,
): TaskEither<Error, void> =>
  pipe(
    setLocalStorage({
      bookmarks,
      bookmarksSchemaVersion: BOOKMARKS_SCHEMA_VERSION,
    }),
    TE.chain(() =>
      sendIsomorphicMessage(IsomorphicMessage.BookmarksUpdatedInLocalStorage),
    ),
  )

export const getStagedBookmarksGroupsFromLocalStorage: TaskEither<
  Error,
  Option<Array<StagedBookmarksGroup>>
> = pipe(
  getLocalStorage("stagedBookmarksGroups"),
  TE.map(({ stagedBookmarksGroups }) => O.fromNullable(stagedBookmarksGroups)),
)

export const saveStagedBookmarksGroupsToLocalStorage = (
  stagedBookmarksGroups: Array<StagedBookmarksGroup>,
): TaskEither<Error, void> => setLocalStorage({ stagedBookmarksGroups })

export const saveStagedBookmarksAsNewGroupToLocalStorage = (
  newStagedBookmarks: NonEmptyArray<LocalBookmarkUnsaved>,
): TaskEither<Error, void> => {
  const stagedBookmarksGroups = pipe(
    getStagedBookmarksGroupsFromLocalStorage,
    TE.map(O.getOrElse((): Array<StagedBookmarksGroup> => [])),
  )

  const newGroup = pipe(
    stagedBookmarksGroups,
    TE.map(
      flow(
        flow(
          A.map(group => group.id),
          createUuid,
          runIO,
        ),
        (id): StagedBookmarksGroup => ({
          id,
          time: new Date().getTime(),
          // Assign each bookmark a generated ID, and ensure they don't clash with
          // one another
          bookmarks: newStagedBookmarks.reduce<Array<LocalBookmark>>(
            (acc, bm) => [
              ...acc,
              {
                ...bm,
                id: createUuid(acc.map(b => b.id))(),
              },
            ],
            [],
          ),
        }),
      ),
    ),
  )

  return pipe(
    sequenceTTE(stagedBookmarksGroups, newGroup),
    TE.chain(([xs, y]) =>
      setLocalStorage({ stagedBookmarksGroups: [...xs, y] }),
    ),
  )
}
