const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const { log, logWarn, logError } = require('../utils/logger');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Base URL of the RealDebrid Free provider service.
const PROVIDER_BASE =
  process.env.PROVIDER_BASE || 'https://tfast.giize.com/bb50769d';

// Path segment if needed by the provider (defaults to empty or standard stream path).
const PROVIDER_PATH_PREFIX =
  process.env.PROVIDER_PATH_PREFIX || '';

// Base URL of the TorrServer instance.
// Used as a fallback when no explicit `torrserver` is provided via query/config.
const TORRSERVER_URL =
  process.env.TORRSERVER_URL || 'http://127.0.0.1:8090';

// Timeout for requests to the provider (in milliseconds).
const PROVIDER_TIMEOUT_MS =
  Number(process.env.PROVIDER_TIMEOUT_MS) || 25000;

// ---------------------------------------------------------------------------
// Addon manifest
// ---------------------------------------------------------------------------

const builder = new addonBuilder({
  id: 'org.stremio.realdebridfree.addon',
  version: '1.2.0',
  name: 'realdebrid free',
  description:
    'Simple addon: fetches torrents from realdebrid free and redirects playback to a local TorrServer instance.',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: []
});

// ---------------------------------------------------------------------------
// Provider integration
// ---------------------------------------------------------------------------

/**
 * Fetch stream candidates from the provider for a given item.
 */
async function fetchProviderStreams({ type, id }) {
  const url = PROVIDER_PATH_PREFIX 
    ? `${PROVIDER_BASE}/${PROVIDER_PATH_PREFIX}/stream/${type}/${id}.json`
    : `${PROVIDER_BASE}/stream/${type}/${id}.json`;

  log('fetchProviderStreams request', { type, id, url });

  const { data } = await axios.get(url, {
    timeout: PROVIDER_TIMEOUT_MS
  });

  if (!data || !Array.isArray(data.streams)) {
    logWarn('Provider responded without a streams array', {
      type,
      id
    });
    return [];
  }

  log('fetchProviderStreams response', {
    type,
    id,
    count: data.streams.length
  });

  return data.streams;
}

// ---------------------------------------------------------------------------
// Play proxy helpers
// ---------------------------------------------------------------------------

/**
 * Build a URL that points back to this addon, which will then resolve the
 * correct TorrServer file and redirect to it via `/play`.
 */
function buildPlayProxyUrl({
  selfBase,
  infoHash,
  type,
  id,
  season,
  episode,
  torrServerBase,
  torrserverUser,
  torrserverPass,
  filename,
  fileIndex
}) {
  if (!selfBase || !infoHash) return null;

  const base = selfBase.replace(/\/+$/, '');
  const params = new URLSearchParams();

  params.set('infoHash', infoHash);
  params.set('type', type);
  params.set('id', id);

  if (torrServerBase) params.set('torrserver', torrServerBase);
  if (torrserverUser) params.set('torrserverUser', torrserverUser);
  if (typeof torrserverPass === 'string') {
    params.set('torrserverPass', torrserverPass);
  }
  if (filename) params.set('filename', filename);
  if (season !== undefined && season !== null) {
    params.set('season', String(season));
  }
  if (episode !== undefined && episode !== null) {
    params.set('episode', String(episode));
  }
  if (fileIndex !== undefined && fileIndex !== null) {
    params.set('fileIndex', String(fileIndex));
  }

  return `${base}/play?${params.toString()}`;
}

/**
 * Build a single Stremio stream entry from a provider candidate.
 */
async function buildStremioStreamFromCandidate({
  candidate,
  index,
  type,
  id,
  torrServerBase,
  torrserverUser,
  torrserverPass,
  selfBase,
  season,
  episode
}) {
  if (!candidate.infoHash) {
    logWarn('Skipping candidate without infoHash', { type, id, index });
    return null;
  }

  if (!selfBase) {
    logWarn('No addon base URL available; cannot build play proxy URL', {
      type,
      id,
      index
    });
    return null;
  }

  const filename =
    (candidate.behaviorHints && candidate.behaviorHints.filename) || '';

  const fileIndex =
    typeof candidate.fileIdx === 'number'
      ? candidate.fileIdx
      : Number.isInteger(Number(candidate.fileIdx))
        ? Number(candidate.fileIdx)
        : undefined;

  const title = candidate.title || filename || candidate.name || 'realdebrid free stream';

  const name = candidate.name || (filename ? `realdebrid free • ${filename}` : 'realdebrid free');

  const streamUrl = buildPlayProxyUrl({
    selfBase,
    infoHash: candidate.infoHash,
    type,
    id,
    season,
    episode,
    torrServerBase,
    torrserverUser,
    torrserverPass,
    filename,
    fileIndex
  });

  if (!streamUrl) {
    logWarn('Failed to build play proxy URL for candidate', {
      type,
      id,
      index
    });
    return null;
  }

  return {
    name,
    title,
    url: streamUrl
  };
}

/**
 * Resolve a single play request into a direct TorrServer URL.
 */
async function resolvePlayUrl({
  torrServerBase,
  type,
  id,
  infoHash,
  season,
  episode,
  filename,
  fileIndex
}) {
  if (!torrServerBase || !infoHash) {
    return null;
  }

  const base = torrServerBase.replace(/\/+$/, '');
  const safeName = encodeURIComponent(
    (filename && String(filename)) || 'video'
  );

  let index = 0;
  if (type === 'movie') {
    index = 1;
  } else if (
    fileIndex !== undefined &&
    fileIndex !== null &&
    !Number.isNaN(Number(fileIndex))
  ) {
    index = Number(fileIndex) + 1;
  }

  const directUrl = `${base}/stream/${safeName}?link=${encodeURIComponent(
    infoHash
  )}&index=${index}&play`;

  log('resolvePlayUrl (no TorrServer stat/preload)', {
    type,
    id,
    infoHash,
    season,
    episode,
    requestedFileIndex: fileIndex,
    resolvedIndex: index,
    torrServerBase,
    directUrl
  });

  return directUrl;
}

// ---------------------------------------------------------------------------
// Stremio stream handler
// ---------------------------------------------------------------------------

builder.defineStreamHandler(async ({ type, id, extra }) => {
  try {
    const torrServerBase =
      (extra && extra.torrserver) || TORRSERVER_URL || null;

    if (!torrServerBase) {
      logWarn('No TorrServer base URL configured', { type, id });
      return { streams: [] };
    }

    const selfBase =
      process.env.SELF_BASE_URL || (extra && extra._base) || null;

    log('Resolved bases for stream handler', {
      type,
      id,
      torrServerBase,
      selfBase
    });

    // 1. Ask the provider for available torrents.
    const streams = await fetchProviderStreams({
      type,
      id
    });

    if (!streams.length) {
      logWarn('No streams returned from provider', { type, id });
      return { streams: [] };
    }

    // 2. Extract season/episode info for series (from id and/or extra).
    let season;
    let episode;

    if (type === 'series') {
      const idParts = String(id).split(':');
      if (idParts.length >= 3) {
        const maybeSeason = parseInt(idParts[idParts.length - 2], 10);
        const maybeEpisode = parseInt(idParts[idParts.length - 1], 10);
        if (!Number.isNaN(maybeSeason)) season = maybeSeason;
        if (!Number.isNaN(maybeEpisode)) episode = maybeEpisode;
      }

      if (extra) {
        if (season === undefined && extra.season) {
          const s = parseInt(extra.season, 10);
          if (!Number.isNaN(s)) season = s;
        }
        if (episode === undefined && extra.episode) {
          const e = parseInt(extra.episode, 10);
          if (!Number.isNaN(e)) episode = e;
        }
      }
    }

    // 3. Build multiple stream options, one per provider candidate.
    const stremioStreams = (
      await Promise.all(
        streams
          .slice(0, 25)
          .map((candidate, index) =>
            buildStremioStreamFromCandidate({
              candidate,
              index,
              type,
              id,
              torrServerBase,
              torrserverUser: extra && extra.torrserverUser,
              torrserverPass: extra && extra.torrserverPass,
              selfBase,
              season,
              episode
            })
          )
      )
    ).filter(Boolean);

    if (!stremioStreams.length) {
      logWarn('No valid candidates after building proxy URLs', { type, id });
      return { streams: [] };
    }

    return { streams: stremioStreams };
  } catch (err) {
    logError('Stream handler error', {
      message: err.message || String(err),
      stack: err.stack
    });
    return { streams: [] };
  }
});

const addonInterface = builder.getInterface();

addonInterface.resolvePlayUrl = resolvePlayUrl;

module.exports = addonInterface;
