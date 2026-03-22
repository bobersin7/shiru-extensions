import AbstractSource from 'https://raw.githubusercontent.com/RockinChaos/Shiru/master/extensions/abstract.js'

const BASE_URL = 'https://feed.animetosho.org/json'

export default new class AnimeTosho extends AbstractSource {
  url = BASE_URL

  async validate() {
    try {
      const res = await fetch(`${this.url}?show=torrent&id=1`)
      return res.ok
    } catch {
      return false
    }
  }

  /**
   * Build a search URL with given params
   */
  _buildUrl(params) {
    const url = new URL(this.url)
    url.searchParams.set('cat', '5070') // anime category
    url.searchParams.set('extended', '1')
    url.searchParams.set('limit', '30')
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v)
    }
    return url.toString()
  }

  /**
   * Map a raw AnimeTosho JSON item to Shiru's TorrentResult shape
   */
  _mapItem(item) {
    if (!item?.torrent_hash) return null
    return {
      title: item.title ?? '',
      link: item.magnet_uri ?? item.torrent_url ?? '',
      seeders: item.seeders ?? 0,
      leechers: item.leechers ?? 0,
      downloads: item.torrent_downloaded_count ?? 0,
      hash: item.torrent_hash.toLowerCase(),
      size: item.total_size ?? 0,
      date: item.timestamp ? new Date(item.timestamp * 1000) : new Date(0),
      accuracy: this._guessAccuracy(item),
    }
  }

  /**
   * Heuristic: if the result came from an ID-based query, it's more accurate
   */
  _guessAccuracy(item, idBased = false) {
    if (idBased) return 'high'
    if (item?.anidb_eid || item?.anidb_aid) return 'high'
    return 'medium'
  }

  /**
   * Fetch and parse results from AnimeTosho JSON API
   */
  async _fetch(params, idBased = false) {
    const url = this._buildUrl(params)
    let res
    try {
      res = await fetch(url)
    } catch {
      return []
    }
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    if (!Array.isArray(data)) return []
    return data
      .map(item => this._mapItem({ ...item, _idBased: idBased }))
      .filter(Boolean)
  }

  /**
   * Build a text query from titles + optional episode
   */
  _buildQuery(titles, episode) {
    // Prefer shorter English titles; avoid very long ones
    const title = titles
      .filter(t => t && t.length < 80)
      .sort((a, b) => a.length - b.length)[0] ?? titles[0] ?? ''

    if (episode !== undefined && episode !== null) {
      const ep = String(episode).padStart(2, '0')
      return `${title} ${ep}`
    }
    return title
  }

  async single(options) {
    const { anidbEid, titles, episode, resolution } = options

    // Prefer AniDB episode ID lookup — highest accuracy
    if (anidbEid) {
      const results = await this._fetch({ eid: anidbEid }, true)
      if (results.length) return this._filterResolution(results, resolution)
    }

    // Fall back to text search
    const q = this._buildQuery(titles, episode)
    if (!q) return []
    const results = await this._fetch({ q })
    return this._filterResolution(results, resolution)
  }

  async batch(options) {
    const { anidbAid, titles, resolution } = options

    // Try AniDB anime ID
    if (anidbAid) {
      const results = await this._fetch({ aid: anidbAid }, true)
      const batches = results.filter(r =>
        /batch|complete|vol/i.test(r.title) || !/ \d{2}[ v\[.]/.test(r.title)
      )
      if (batches.length) return this._filterResolution(batches, resolution)
    }

    // Fall back to title query without episode
    const q = this._buildQuery(titles, undefined)
    if (!q) return []
    const results = await this._fetch({ q: `${q} batch` })
    return this._filterResolution(results, resolution)
  }

  async movie(options) {
    const { anidbAid, titles, resolution } = options

    if (anidbAid) {
      const results = await this._fetch({ aid: anidbAid }, true)
      if (results.length) return this._filterResolution(results, resolution)
    }

    const q = this._buildQuery(titles, undefined)
    if (!q) return []
    const results = await this._fetch({ q })
    return this._filterResolution(results, resolution)
  }

  /**
   * Filter results to preferred resolution when specified
   */
  _filterResolution(results, resolution) {
    if (!resolution) return results
    const preferred = results.filter(r =>
      r.title.includes(resolution + 'p') || r.title.includes(resolution)
    )
    return preferred.length ? preferred : results
  }
}()
