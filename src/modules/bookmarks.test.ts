import {
  filterBookmark,
  transform,
  untransform,
  LocalBookmark,
  RemoteBookmark,
} from "~/modules/bookmarks"
import { ParsedInputResult } from "~/modules/parse-search-input"

describe("filter bookmarks with parsed input case insensitively", () => {
  const coolBookmark: LocalBookmark = {
    id: 0,
    title: "Cool bookmark",
    desc: "Some other words",
    url: "https://duckduckgo.com",
    tags: ["awesome", "supreme"],
    flags: 0,
  }

  const superBookmark: LocalBookmark = {
    id: 42,
    title: "Super duper website. Awesome",
    desc: "Legitimately fantastic",
    url: "https://blog.samhh.com",
    tags: ["impeccable"],
    flags: 1,
  }

  const incredibleBookmark: LocalBookmark = {
    id: 1337,
    title: "Incredibly excellent",
    desc: "Truly outstanding and duper awesome",
    url: "http://www.samhh.com",
    tags: ["great", "superb", "supreme"],
    flags: 20,
  }

  const unstoppableBookmark: LocalBookmark = {
    id: 99999,
    title: "Unstoppable",
    desc: "",
    url: "https://samhh.com/awesome",
    tags: [],
    flags: 999,
  }

  const emptyParsedInput: ParsedInputResult = {
    name: "",
    desc: [],
    url: [],
    tags: [],
    wildcard: [],
  }

  test("filter by title", () => {
    const titleFilter = filterBookmark({
      ...emptyParsedInput,
      name: "awesome",
    })

    expect(titleFilter(coolBookmark)).toStrictEqual(false)
    expect(titleFilter(superBookmark)).toStrictEqual(true)
    expect(titleFilter(incredibleBookmark)).toStrictEqual(false)
    expect(titleFilter(unstoppableBookmark)).toStrictEqual(false)
  })

  test("filter by url", () => {
    const urlFilter = filterBookmark({
      ...emptyParsedInput,
      url: ["samhh.com"],
    })

    expect(urlFilter(coolBookmark)).toStrictEqual(false)
    expect(urlFilter(superBookmark)).toStrictEqual(true)
    expect(urlFilter(incredibleBookmark)).toStrictEqual(true)
    expect(urlFilter(unstoppableBookmark)).toStrictEqual(true)
  })

  test("filter by wildcard", () => {
    const wildcardFilter = filterBookmark({
      ...emptyParsedInput,
      wildcard: ["supreme", "duckduck"],
    })

    expect(wildcardFilter(coolBookmark)).toStrictEqual(true)
    expect(wildcardFilter(superBookmark)).toStrictEqual(false)
    expect(wildcardFilter(incredibleBookmark)).toStrictEqual(false)
    expect(wildcardFilter(unstoppableBookmark)).toStrictEqual(false)
  })
})

describe("schema transform", () => {
  test("transform remote bookmark to local bookmark", () => {
    const remoteBm: RemoteBookmark = {
      id: 123,
      metadata: "meta",
      desc: "",
      url: "URL",
      tags: ",1,b,xx,",
      flags: 0,
    }

    const remoteBmLegacy: RemoteBookmark = {
      id: 123,
      metadata: "meta",
      desc: "",
      url: "URL",
      tags: "1,b,xx",
      flags: 0,
    }

    const expectedLocalBm: LocalBookmark = {
      id: 123,
      title: "meta",
      tags: ["1", "b", "xx"],
      url: "URL",
      desc: "",
      flags: 0,
    }

    expect(transform(remoteBm)).toStrictEqual(expectedLocalBm)
    expect(transform(remoteBmLegacy)).toStrictEqual(expectedLocalBm)
  })

  test("untransform local bookmark to remote bookmark", () => {
    const localBm: LocalBookmark = {
      id: 123,
      title: "meta",
      tags: ["1", "b", "xx"],
      url: "URL",
      desc: "",
      flags: 0,
    }

    const expectedRemoteBm: RemoteBookmark = {
      id: 123,
      metadata: "meta",
      desc: "",
      url: "URL",
      tags: ",1,b,xx,",
      flags: 0,
    }

    expect(untransform(localBm)).toStrictEqual(expectedRemoteBm)
  })
})
