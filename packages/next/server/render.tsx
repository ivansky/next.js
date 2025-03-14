import { IncomingMessage, ServerResponse } from 'http'
import { ParsedUrlQuery } from 'querystring'
import type { Writable as WritableType } from 'stream'
import React from 'react'
import ReactDOMServer from 'react-dom/server'
import { createFromReadableStream } from 'next/dist/compiled/react-server-dom-webpack'
import { renderToReadableStream } from 'next/dist/compiled/react-server-dom-webpack/writer.browser.server'
import { StyleRegistry, createStyleRegistry } from 'styled-jsx'
import { UnwrapPromise } from '../lib/coalesced-function'
import {
  GSP_NO_RETURNED_VALUE,
  GSSP_COMPONENT_MEMBER_ERROR,
  GSSP_NO_RETURNED_VALUE,
  STATIC_STATUS_PAGE_GET_INITIAL_PROPS_ERROR,
  SERVER_PROPS_GET_INIT_PROPS_CONFLICT,
  SERVER_PROPS_SSG_CONFLICT,
  SSG_GET_INITIAL_PROPS_CONFLICT,
  UNSTABLE_REVALIDATE_RENAME_ERROR,
} from '../lib/constants'
import { isSerializableProps } from '../lib/is-serializable-props'
import { GetServerSideProps, GetStaticProps, PreviewData } from '../types'
import { isInAmpMode } from '../shared/lib/amp'
import { AmpStateContext } from '../shared/lib/amp-context'
import {
  SERVER_PROPS_ID,
  STATIC_PROPS_ID,
  STATIC_STATUS_PAGES,
} from '../shared/lib/constants'
import { defaultHead } from '../shared/lib/head'
import { HeadManagerContext } from '../shared/lib/head-manager-context'
import Loadable from '../shared/lib/loadable'
import { LoadableContext } from '../shared/lib/loadable-context'
import { RouterContext } from '../shared/lib/router-context'
import { NextRouter } from '../shared/lib/router/router'
import { isDynamicRoute } from '../shared/lib/router/utils/is-dynamic'
import {
  AppType,
  ComponentsEnhancer,
  DocumentInitialProps,
  DocumentProps,
  DocumentContext,
  HtmlContext,
  HtmlProps,
  getDisplayName,
  isResSent,
  loadGetInitialProps,
  NextComponentType,
  RenderPage,
  RenderPageResult,
} from '../shared/lib/utils'
import type { NextApiRequestCookies, __ApiPreviewProps } from './api-utils'
import { denormalizePagePath } from './denormalize-page-path'
import type { FontManifest } from './font-utils'
import type { LoadComponentsReturnType, ManifestItem } from './load-components'
import { normalizePagePath } from './normalize-page-path'
import { getRequestMeta, NextParsedUrlQuery } from './request-meta'
import {
  allowedStatusCodes,
  getRedirectStatus,
  Redirect,
} from '../lib/load-custom-routes'
import { DomainLocale } from './config'
import RenderResult, { NodeWritablePiper } from './render-result'
import isError from '../lib/is-error'

let Writable: typeof import('stream').Writable
let Buffer: typeof import('buffer').Buffer
let optimizeAmp: typeof import('./optimize-amp').default
let getFontDefinitionFromManifest: typeof import('./font-utils').getFontDefinitionFromManifest
let tryGetPreviewData: typeof import('./api-utils').tryGetPreviewData
let warn: typeof import('../build/output/log').warn
let postProcess: typeof import('../shared/lib/post-process').default

const DOCTYPE = '<!DOCTYPE html>'

if (!process.browser) {
  Writable = require('stream').Writable
  Buffer = require('buffer').Buffer
  optimizeAmp = require('./optimize-amp').default
  getFontDefinitionFromManifest =
    require('./font-utils').getFontDefinitionFromManifest
  tryGetPreviewData = require('./api-utils').tryGetPreviewData
  warn = require('../build/output/log').warn
  postProcess = require('../shared/lib/post-process').default
} else {
  warn = console.warn.bind(console)
}

function noRouter() {
  const message =
    'No router instance found. you should only use "next/router" inside the client side of your app. https://nextjs.org/docs/messages/no-router-instance'
  throw new Error(message)
}

class ServerRouter implements NextRouter {
  route: string
  pathname: string
  query: ParsedUrlQuery
  asPath: string
  basePath: string
  events: any
  isFallback: boolean
  locale?: string
  isReady: boolean
  locales?: string[]
  defaultLocale?: string
  domainLocales?: DomainLocale[]
  isPreview: boolean
  isLocaleDomain: boolean

  constructor(
    pathname: string,
    query: ParsedUrlQuery,
    as: string,
    { isFallback }: { isFallback: boolean },
    isReady: boolean,
    basePath: string,
    locale?: string,
    locales?: string[],
    defaultLocale?: string,
    domainLocales?: DomainLocale[],
    isPreview?: boolean,
    isLocaleDomain?: boolean
  ) {
    this.route = pathname.replace(/\/$/, '') || '/'
    this.pathname = pathname
    this.query = query
    this.asPath = as
    this.isFallback = isFallback
    this.basePath = basePath
    this.locale = locale
    this.locales = locales
    this.defaultLocale = defaultLocale
    this.isReady = isReady
    this.domainLocales = domainLocales
    this.isPreview = !!isPreview
    this.isLocaleDomain = !!isLocaleDomain
  }

  push(): any {
    noRouter()
  }
  replace(): any {
    noRouter()
  }
  reload() {
    noRouter()
  }
  back() {
    noRouter()
  }
  prefetch(): any {
    noRouter()
  }
  beforePopState() {
    noRouter()
  }
}

function enhanceComponents(
  options: ComponentsEnhancer,
  App: AppType,
  Component: NextComponentType
): {
  App: AppType
  Component: NextComponentType
} {
  // For backwards compatibility
  if (typeof options === 'function') {
    return {
      App,
      Component: options(Component),
    }
  }

  return {
    App: options.enhanceApp ? options.enhanceApp(App) : App,
    Component: options.enhanceComponent
      ? options.enhanceComponent(Component)
      : Component,
  }
}

export type RenderOptsPartial = {
  buildId: string
  canonicalBase: string
  runtimeConfig?: { [key: string]: any }
  assetPrefix?: string
  err?: Error | null
  nextExport?: boolean
  dev?: boolean
  ampPath?: string
  ErrorDebug?: React.ComponentType<{ error: Error }>
  ampValidator?: (html: string, pathname: string) => Promise<void>
  ampSkipValidation?: boolean
  ampOptimizerConfig?: { [key: string]: any }
  isDataReq?: boolean
  params?: ParsedUrlQuery
  previewProps: __ApiPreviewProps
  basePath: string
  unstable_runtimeJS?: false
  unstable_JsPreload?: false
  optimizeFonts: boolean
  fontManifest?: FontManifest
  optimizeImages: boolean
  optimizeCss: any
  devOnlyCacheBusterQueryString?: string
  resolvedUrl?: string
  resolvedAsPath?: string
  serverComponentManifest?: any
  renderServerComponentData?: boolean
  distDir?: string
  locale?: string
  locales?: string[]
  defaultLocale?: string
  domainLocales?: DomainLocale[]
  disableOptimizedLoading?: boolean
  supportsDynamicHTML?: boolean
  concurrentFeatures?: boolean
  customServer?: boolean
}

export type RenderOpts = LoadComponentsReturnType & RenderOptsPartial

const invalidKeysMsg = (methodName: string, invalidKeys: string[]) => {
  return (
    `Additional keys were returned from \`${methodName}\`. Properties intended for your component must be nested under the \`props\` key, e.g.:` +
    `\n\n\treturn { props: { title: 'My Title', content: '...' } }` +
    `\n\nKeys that need to be moved: ${invalidKeys.join(', ')}.` +
    `\nRead more: https://nextjs.org/docs/messages/invalid-getstaticprops-value`
  )
}

function checkRedirectValues(
  redirect: Redirect,
  req: IncomingMessage,
  method: 'getStaticProps' | 'getServerSideProps'
) {
  const { destination, permanent, statusCode, basePath } = redirect
  let errors: string[] = []

  const hasStatusCode = typeof statusCode !== 'undefined'
  const hasPermanent = typeof permanent !== 'undefined'

  if (hasPermanent && hasStatusCode) {
    errors.push(`\`permanent\` and \`statusCode\` can not both be provided`)
  } else if (hasPermanent && typeof permanent !== 'boolean') {
    errors.push(`\`permanent\` must be \`true\` or \`false\``)
  } else if (hasStatusCode && !allowedStatusCodes.has(statusCode!)) {
    errors.push(
      `\`statusCode\` must undefined or one of ${[...allowedStatusCodes].join(
        ', '
      )}`
    )
  }
  const destinationType = typeof destination

  if (destinationType !== 'string') {
    errors.push(
      `\`destination\` should be string but received ${destinationType}`
    )
  }

  const basePathType = typeof basePath

  if (basePathType !== 'undefined' && basePathType !== 'boolean') {
    errors.push(
      `\`basePath\` should be undefined or a false, received ${basePathType}`
    )
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid redirect object returned from ${method} for ${req.url}\n` +
        errors.join(' and ') +
        '\n' +
        `See more info here: https://nextjs.org/docs/messages/invalid-redirect-gssp`
    )
  }
}

// Create the wrapper component for a Flight stream.
function createServerComponentRenderer(
  OriginalComponent: React.ComponentType,
  serverComponentManifest: NonNullable<RenderOpts['serverComponentManifest']>
) {
  let responseCache: any
  const ServerComponentWrapper = (props: any) => {
    let response = responseCache
    if (!response) {
      responseCache = response = createFromReadableStream(
        renderToReadableStream(
          <OriginalComponent {...props} />,
          serverComponentManifest
        )
      )
    }
    return response.readRoot()
  }
  const Component = (props: any) => {
    return (
      <React.Suspense fallback={null}>
        <ServerComponentWrapper {...props} />
      </React.Suspense>
    )
  }

  // Although it's not allowed to attach some static methods to Component,
  // we still re-assign all the component APIs to keep the behavior unchanged.
  for (const methodName of [
    'getInitialProps',
    'getStaticProps',
    'getServerSideProps',
    'getStaticPaths',
  ]) {
    const method = (OriginalComponent as any)[methodName]
    if (method) {
      ;(Component as any)[methodName] = method
    }
  }

  return Component
}

export async function renderToHTML(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: NextParsedUrlQuery,
  renderOpts: RenderOpts
): Promise<RenderResult | null> {
  // In dev we invalidate the cache by appending a timestamp to the resource URL.
  // This is a workaround to fix https://github.com/vercel/next.js/issues/5860
  // TODO: remove this workaround when https://bugs.webkit.org/show_bug.cgi?id=187726 is fixed.
  renderOpts.devOnlyCacheBusterQueryString = renderOpts.dev
    ? renderOpts.devOnlyCacheBusterQueryString || `?ts=${Date.now()}`
    : ''

  // don't modify original query object
  query = Object.assign({}, query)

  const {
    err,
    dev = false,
    ampPath = '',
    App,
    Document,
    pageConfig = {},
    buildManifest,
    fontManifest,
    reactLoadableManifest,
    ErrorDebug,
    getStaticProps,
    getStaticPaths,
    getServerSideProps,
    serverComponentManifest,
    renderServerComponentData,
    isDataReq,
    params,
    previewProps,
    basePath,
    devOnlyCacheBusterQueryString,
    supportsDynamicHTML,
    concurrentFeatures,
  } = renderOpts

  const isServerComponent = !!serverComponentManifest
  const OriginalComponent = renderOpts.Component
  const Component = isServerComponent
    ? createServerComponentRenderer(OriginalComponent, serverComponentManifest)
    : renderOpts.Component

  const getFontDefinition = (url: string): string => {
    if (fontManifest) {
      return getFontDefinitionFromManifest(url, fontManifest)
    }
    return ''
  }

  const callMiddleware = async (method: string, args: any[], props = false) => {
    let results: any = props ? {} : []

    if ((Document as any)[`${method}Middleware`]) {
      let middlewareFunc = await (Document as any)[`${method}Middleware`]
      middlewareFunc = middlewareFunc.default || middlewareFunc

      const curResults = await middlewareFunc(...args)
      if (props) {
        for (const result of curResults) {
          results = {
            ...results,
            ...result,
          }
        }
      } else {
        results = curResults
      }
    }
    return results
  }

  const headTags = (...args: any) => callMiddleware('headTags', args)

  const isFallback = !!query.__nextFallback
  delete query.__nextFallback
  delete query.__nextLocale
  delete query.__nextDefaultLocale

  const isSSG = !!getStaticProps
  const isBuildTimeSSG = isSSG && renderOpts.nextExport
  const defaultAppGetInitialProps =
    App.getInitialProps === (App as any).origGetInitialProps

  const hasPageGetInitialProps = !!(Component as any).getInitialProps

  const pageIsDynamic = isDynamicRoute(pathname)

  const isAutoExport =
    !hasPageGetInitialProps &&
    defaultAppGetInitialProps &&
    !isSSG &&
    !getServerSideProps

  for (const methodName of [
    'getStaticProps',
    'getServerSideProps',
    'getStaticPaths',
  ]) {
    if ((Component as any)[methodName]) {
      throw new Error(
        `page ${pathname} ${methodName} ${GSSP_COMPONENT_MEMBER_ERROR}`
      )
    }
  }

  if (hasPageGetInitialProps && isSSG) {
    throw new Error(SSG_GET_INITIAL_PROPS_CONFLICT + ` ${pathname}`)
  }

  if (hasPageGetInitialProps && getServerSideProps) {
    throw new Error(SERVER_PROPS_GET_INIT_PROPS_CONFLICT + ` ${pathname}`)
  }

  if (getServerSideProps && isSSG) {
    throw new Error(SERVER_PROPS_SSG_CONFLICT + ` ${pathname}`)
  }

  if (getStaticPaths && !pageIsDynamic) {
    throw new Error(
      `getStaticPaths is only allowed for dynamic SSG pages and was found on '${pathname}'.` +
        `\nRead more: https://nextjs.org/docs/messages/non-dynamic-getstaticpaths-usage`
    )
  }

  if (!!getStaticPaths && !isSSG) {
    throw new Error(
      `getStaticPaths was added without a getStaticProps in ${pathname}. Without getStaticProps, getStaticPaths does nothing`
    )
  }

  if (isSSG && pageIsDynamic && !getStaticPaths) {
    throw new Error(
      `getStaticPaths is required for dynamic SSG pages and is missing for '${pathname}'.` +
        `\nRead more: https://nextjs.org/docs/messages/invalid-getstaticpaths-value`
    )
  }

  let asPath: string = renderOpts.resolvedAsPath || (req.url as string)

  if (dev) {
    const { isValidElementType } = require('react-is')
    if (!isValidElementType(Component)) {
      throw new Error(
        `The default export is not a React Component in page: "${pathname}"`
      )
    }

    if (!isValidElementType(App)) {
      throw new Error(
        `The default export is not a React Component in page: "/_app"`
      )
    }

    if (!isValidElementType(Document)) {
      throw new Error(
        `The default export is not a React Component in page: "/_document"`
      )
    }

    if (isAutoExport || isFallback) {
      // remove query values except ones that will be set during export
      query = {
        ...(query.amp
          ? {
              amp: query.amp,
            }
          : {}),
      }
      asPath = `${pathname}${
        // ensure trailing slash is present for non-dynamic auto-export pages
        req.url!.endsWith('/') && pathname !== '/' && !pageIsDynamic ? '/' : ''
      }`
      req.url = pathname
    }

    if (pathname === '/404' && (hasPageGetInitialProps || getServerSideProps)) {
      throw new Error(
        `\`pages/404\` ${STATIC_STATUS_PAGE_GET_INITIAL_PROPS_ERROR}`
      )
    }
    if (
      STATIC_STATUS_PAGES.includes(pathname) &&
      (hasPageGetInitialProps || getServerSideProps)
    ) {
      throw new Error(
        `\`pages${pathname}\` ${STATIC_STATUS_PAGE_GET_INITIAL_PROPS_ERROR}`
      )
    }
  }

  await Loadable.preloadAll() // Make sure all dynamic imports are loaded

  let isPreview
  let previewData: PreviewData

  if ((isSSG || getServerSideProps) && !isFallback && !process.browser) {
    // Reads of this are cached on the `req` object, so this should resolve
    // instantly. There's no need to pass this data down from a previous
    // invoke, where we'd have to consider server & serverless.
    previewData = tryGetPreviewData(req, res, previewProps)
    isPreview = previewData !== false
  }

  // url will always be set
  const routerIsReady = !!(
    getServerSideProps ||
    hasPageGetInitialProps ||
    (!defaultAppGetInitialProps && !isSSG)
  )
  const router = new ServerRouter(
    pathname,
    query,
    asPath,
    {
      isFallback: isFallback,
    },
    routerIsReady,
    basePath,
    renderOpts.locale,
    renderOpts.locales,
    renderOpts.defaultLocale,
    renderOpts.domainLocales,
    isPreview,
    getRequestMeta(req, '__nextIsLocaleDomain')
  )
  const jsxStyleRegistry = createStyleRegistry()
  const ctx = {
    err,
    req: isAutoExport ? undefined : req,
    res: isAutoExport ? undefined : res,
    pathname,
    query,
    asPath,
    locale: renderOpts.locale,
    locales: renderOpts.locales,
    defaultLocale: renderOpts.defaultLocale,
    AppTree: (props: any) => {
      return (
        <AppContainerWithIsomorphicFiberStructure>
          <App {...props} Component={Component} router={router} />
        </AppContainerWithIsomorphicFiberStructure>
      )
    },
    defaultGetInitialProps: async (
      docCtx: DocumentContext
    ): Promise<DocumentInitialProps> => {
      const enhanceApp = (AppComp: any) => {
        return (props: any) => <AppComp {...props} />
      }

      const { html, head } = await docCtx.renderPage({ enhanceApp })
      const styles = jsxStyleRegistry.styles()
      return { html, head, styles }
    },
  }
  let props: any

  const ampState = {
    ampFirst: pageConfig.amp === true,
    hasQuery: Boolean(query.amp),
    hybrid: pageConfig.amp === 'hybrid',
  }

  // Disable AMP under the web environment
  const inAmpMode = !process.browser && isInAmpMode(ampState)

  const reactLoadableModules: string[] = []

  let head: JSX.Element[] = defaultHead(inAmpMode)

  let scriptLoader: any = {}
  const nextExport =
    !isSSG && (renderOpts.nextExport || (dev && (isAutoExport || isFallback)))

  const AppContainer = ({ children }: { children: JSX.Element }) => (
    <RouterContext.Provider value={router}>
      <AmpStateContext.Provider value={ampState}>
        <HeadManagerContext.Provider
          value={{
            updateHead: (state) => {
              head = state
            },
            updateScripts: (scripts) => {
              scriptLoader = scripts
            },
            scripts: {},
            mountedInstances: new Set(),
          }}
        >
          <LoadableContext.Provider
            value={(moduleName) => reactLoadableModules.push(moduleName)}
          >
            <StyleRegistry registry={jsxStyleRegistry}>
              {children}
            </StyleRegistry>
          </LoadableContext.Provider>
        </HeadManagerContext.Provider>
      </AmpStateContext.Provider>
    </RouterContext.Provider>
  )

  // The `useId` API uses the path indexes to generate an ID for each node.
  // To guarantee the match of hydration, we need to ensure that the structure
  // of wrapper nodes is isomorphic in server and client.
  // TODO: With `enhanceApp` and `enhanceComponents` options, this approach may
  // not be useful.
  // https://github.com/facebook/react/pull/22644
  const Noop = () => null
  const AppContainerWithIsomorphicFiberStructure = ({
    children,
  }: {
    children: JSX.Element
  }) => {
    return (
      <>
        {/* <Head/> */}
        <Noop />
        <AppContainer>
          <>
            {/* <ReactDevOverlay/> */}
            {dev ? (
              <>
                {children}
                <Noop />
              </>
            ) : (
              children
            )}
            {/* <RouteAnnouncer/> */}
            <Noop />
          </>
        </AppContainer>
      </>
    )
  }

  props = await loadGetInitialProps(App, {
    AppTree: ctx.AppTree,
    Component,
    router,
    ctx,
  })

  if ((isSSG || getServerSideProps) && isPreview) {
    props.__N_PREVIEW = true
  }

  if (isSSG) {
    props[STATIC_PROPS_ID] = true
  }

  if (isSSG && !isFallback) {
    let data: UnwrapPromise<ReturnType<GetStaticProps>>

    try {
      data = await getStaticProps!({
        ...(pageIsDynamic ? { params: query as ParsedUrlQuery } : undefined),
        ...(isPreview
          ? { preview: true, previewData: previewData }
          : undefined),
        locales: renderOpts.locales,
        locale: renderOpts.locale,
        defaultLocale: renderOpts.defaultLocale,
      })
    } catch (staticPropsError: any) {
      // remove not found error code to prevent triggering legacy
      // 404 rendering
      if (staticPropsError && staticPropsError.code === 'ENOENT') {
        delete staticPropsError.code
      }
      throw staticPropsError
    }

    if (data == null) {
      throw new Error(GSP_NO_RETURNED_VALUE)
    }

    const invalidKeys = Object.keys(data).filter(
      (key) =>
        key !== 'revalidate' &&
        key !== 'props' &&
        key !== 'redirect' &&
        key !== 'notFound'
    )

    if (invalidKeys.includes('unstable_revalidate')) {
      throw new Error(UNSTABLE_REVALIDATE_RENAME_ERROR)
    }

    if (invalidKeys.length) {
      throw new Error(invalidKeysMsg('getStaticProps', invalidKeys))
    }

    if (process.env.NODE_ENV !== 'production') {
      if (
        typeof (data as any).notFound !== 'undefined' &&
        typeof (data as any).redirect !== 'undefined'
      ) {
        throw new Error(
          `\`redirect\` and \`notFound\` can not both be returned from ${
            isSSG ? 'getStaticProps' : 'getServerSideProps'
          } at the same time. Page: ${pathname}\nSee more info here: https://nextjs.org/docs/messages/gssp-mixed-not-found-redirect`
        )
      }
    }

    if ('notFound' in data && data.notFound) {
      if (pathname === '/404') {
        throw new Error(
          `The /404 page can not return notFound in "getStaticProps", please remove it to continue!`
        )
      }

      ;(renderOpts as any).isNotFound = true
    }

    if (
      'redirect' in data &&
      data.redirect &&
      typeof data.redirect === 'object'
    ) {
      checkRedirectValues(data.redirect as Redirect, req, 'getStaticProps')

      if (isBuildTimeSSG) {
        throw new Error(
          `\`redirect\` can not be returned from getStaticProps during prerendering (${req.url})\n` +
            `See more info here: https://nextjs.org/docs/messages/gsp-redirect-during-prerender`
        )
      }

      ;(data as any).props = {
        __N_REDIRECT: data.redirect.destination,
        __N_REDIRECT_STATUS: getRedirectStatus(data.redirect),
      }
      if (typeof data.redirect.basePath !== 'undefined') {
        ;(data as any).props.__N_REDIRECT_BASE_PATH = data.redirect.basePath
      }
      ;(renderOpts as any).isRedirect = true
    }

    if (
      (dev || isBuildTimeSSG) &&
      !(renderOpts as any).isNotFound &&
      !isSerializableProps(pathname, 'getStaticProps', (data as any).props)
    ) {
      // this fn should throw an error instead of ever returning `false`
      throw new Error(
        'invariant: getStaticProps did not return valid props. Please report this.'
      )
    }

    if ('revalidate' in data) {
      if (typeof data.revalidate === 'number') {
        if (!Number.isInteger(data.revalidate)) {
          throw new Error(
            `A page's revalidate option must be seconds expressed as a natural number for ${req.url}. Mixed numbers, such as '${data.revalidate}', cannot be used.` +
              `\nTry changing the value to '${Math.ceil(
                data.revalidate
              )}' or using \`Math.ceil()\` if you're computing the value.`
          )
        } else if (data.revalidate <= 0) {
          throw new Error(
            `A page's revalidate option can not be less than or equal to zero for ${req.url}. A revalidate option of zero means to revalidate after _every_ request, and implies stale data cannot be tolerated.` +
              `\n\nTo never revalidate, you can set revalidate to \`false\` (only ran once at build-time).` +
              `\nTo revalidate as soon as possible, you can set the value to \`1\`.`
          )
        } else if (data.revalidate > 31536000) {
          // if it's greater than a year for some reason error
          console.warn(
            `Warning: A page's revalidate option was set to more than a year for ${req.url}. This may have been done in error.` +
              `\nTo only run getStaticProps at build-time and not revalidate at runtime, you can set \`revalidate\` to \`false\`!`
          )
        }
      } else if (data.revalidate === true) {
        // When enabled, revalidate after 1 second. This value is optimal for
        // the most up-to-date page possible, but without a 1-to-1
        // request-refresh ratio.
        data.revalidate = 1
      } else if (
        data.revalidate === false ||
        typeof data.revalidate === 'undefined'
      ) {
        // By default, we never revalidate.
        data.revalidate = false
      } else {
        throw new Error(
          `A page's revalidate option must be seconds expressed as a natural number. Mixed numbers and strings cannot be used. Received '${JSON.stringify(
            data.revalidate
          )}' for ${req.url}`
        )
      }
    } else {
      // By default, we never revalidate.
      ;(data as any).revalidate = false
    }

    props.pageProps = Object.assign(
      {},
      props.pageProps,
      'props' in data ? data.props : undefined
    )

    // pass up revalidate and props for export
    // TODO: change this to a different passing mechanism
    ;(renderOpts as any).revalidate =
      'revalidate' in data ? data.revalidate : undefined
    ;(renderOpts as any).pageData = props

    // this must come after revalidate is added to renderOpts
    if ((renderOpts as any).isNotFound) {
      return null
    }
  }

  if (getServerSideProps) {
    props[SERVER_PROPS_ID] = true
  }

  if (getServerSideProps && !isFallback) {
    let data: UnwrapPromise<ReturnType<GetServerSideProps>>

    let canAccessRes = true
    let resOrProxy = res
    let deferredContent = false
    if (process.env.NODE_ENV !== 'production') {
      resOrProxy = new Proxy<ServerResponse>(res, {
        get: function (obj, prop, receiver) {
          if (!canAccessRes) {
            const message =
              `You should not access 'res' after getServerSideProps resolves.` +
              `\nRead more: https://nextjs.org/docs/messages/gssp-no-mutating-res`

            if (deferredContent) {
              throw new Error(message)
            } else {
              warn(message)
            }
          }
          return Reflect.get(obj, prop, receiver)
        },
      })
    }

    try {
      data = await getServerSideProps({
        req: req as IncomingMessage & {
          cookies: NextApiRequestCookies
        },
        res: resOrProxy,
        query,
        resolvedUrl: renderOpts.resolvedUrl as string,
        ...(pageIsDynamic ? { params: params as ParsedUrlQuery } : undefined),
        ...(previewData !== false
          ? { preview: true, previewData: previewData }
          : undefined),
        locales: renderOpts.locales,
        locale: renderOpts.locale,
        defaultLocale: renderOpts.defaultLocale,
      })
      canAccessRes = false
    } catch (serverSidePropsError: any) {
      // remove not found error code to prevent triggering legacy
      // 404 rendering
      if (
        isError(serverSidePropsError) &&
        serverSidePropsError.code === 'ENOENT'
      ) {
        delete serverSidePropsError.code
      }
      throw serverSidePropsError
    }

    if (data == null) {
      throw new Error(GSSP_NO_RETURNED_VALUE)
    }

    if ((data as any).props instanceof Promise) {
      deferredContent = true
    }

    const invalidKeys = Object.keys(data).filter(
      (key) => key !== 'props' && key !== 'redirect' && key !== 'notFound'
    )

    if ((data as any).unstable_notFound) {
      throw new Error(
        `unstable_notFound has been renamed to notFound, please update the field to continue. Page: ${pathname}`
      )
    }
    if ((data as any).unstable_redirect) {
      throw new Error(
        `unstable_redirect has been renamed to redirect, please update the field to continue. Page: ${pathname}`
      )
    }

    if (invalidKeys.length) {
      throw new Error(invalidKeysMsg('getServerSideProps', invalidKeys))
    }

    if ('notFound' in data && data.notFound) {
      if (pathname === '/404') {
        throw new Error(
          `The /404 page can not return notFound in "getStaticProps", please remove it to continue!`
        )
      }

      ;(renderOpts as any).isNotFound = true
      return null
    }

    if ('redirect' in data && typeof data.redirect === 'object') {
      checkRedirectValues(data.redirect as Redirect, req, 'getServerSideProps')
      ;(data as any).props = {
        __N_REDIRECT: data.redirect.destination,
        __N_REDIRECT_STATUS: getRedirectStatus(data.redirect),
      }
      if (typeof data.redirect.basePath !== 'undefined') {
        ;(data as any).props.__N_REDIRECT_BASE_PATH = data.redirect.basePath
      }
      ;(renderOpts as any).isRedirect = true
    }

    if (deferredContent) {
      ;(data as any).props = await (data as any).props
    }

    if (
      (dev || isBuildTimeSSG) &&
      !isSerializableProps(pathname, 'getServerSideProps', (data as any).props)
    ) {
      // this fn should throw an error instead of ever returning `false`
      throw new Error(
        'invariant: getServerSideProps did not return valid props. Please report this.'
      )
    }

    props.pageProps = Object.assign({}, props.pageProps, (data as any).props)
    ;(renderOpts as any).pageData = props
  }

  if (
    !isSSG && // we only show this warning for legacy pages
    !getServerSideProps &&
    process.env.NODE_ENV !== 'production' &&
    Object.keys(props?.pageProps || {}).includes('url')
  ) {
    console.warn(
      `The prop \`url\` is a reserved prop in Next.js for legacy reasons and will be overridden on page ${pathname}\n` +
        `See more info here: https://nextjs.org/docs/messages/reserved-page-prop`
    )
  }

  // Avoid rendering page un-necessarily for getServerSideProps data request
  // and getServerSideProps/getStaticProps redirects
  if ((isDataReq && !isSSG) || (renderOpts as any).isRedirect) {
    return RenderResult.fromStatic(JSON.stringify(props))
  }

  // We don't call getStaticProps or getServerSideProps while generating
  // the fallback so make sure to set pageProps to an empty object
  if (isFallback) {
    props.pageProps = {}
  }

  // Pass router to the Server Component as a temporary workaround.
  if (isServerComponent) {
    props.pageProps = Object.assign({}, props.pageProps, { router })
  }

  // the response might be finished on the getInitialProps call
  if (isResSent(res) && !isSSG) return null

  if (renderServerComponentData) {
    const stream: ReadableStream = renderToReadableStream(
      <OriginalComponent {...props.pageProps} />,
      serverComponentManifest
    )
    const reader = stream.getReader()
    return new RenderResult((innerRes, next) => {
      bufferedReadFromReadableStream(reader, (val) => innerRes.write(val)).then(
        () => next(),
        (innerErr) => next(innerErr)
      )
    })
  }

  // we preload the buildManifest for auto-export dynamic pages
  // to speed up hydrating query values
  let filteredBuildManifest = buildManifest
  if (isAutoExport && pageIsDynamic) {
    const page = denormalizePagePath(normalizePagePath(pathname))
    // This code would be much cleaner using `immer` and directly pushing into
    // the result from `getPageFiles`, we could maybe consider that in the
    // future.
    if (page in filteredBuildManifest.pages) {
      filteredBuildManifest = {
        ...filteredBuildManifest,
        pages: {
          ...filteredBuildManifest.pages,
          [page]: [
            ...filteredBuildManifest.pages[page],
            ...filteredBuildManifest.lowPriorityFiles.filter((f) =>
              f.includes('_buildManifest')
            ),
          ],
        },
        lowPriorityFiles: filteredBuildManifest.lowPriorityFiles.filter(
          (f) => !f.includes('_buildManifest')
        ),
      }
    }
  }

  const Body = ({ children }: { children: JSX.Element }) => {
    return inAmpMode ? children : <div id="__next">{children}</div>
  }

  const appWrappers: Array<(content: JSX.Element) => JSX.Element> = []
  const getWrappedApp = (app: JSX.Element) => {
    // Prevent wrappers from reading/writing props by rendering inside an
    // opaque component. Wrappers should use context instead.
    const InnerApp = () => app
    return (
      <AppContainerWithIsomorphicFiberStructure>
        {appWrappers.reduceRight((innerContent, fn) => {
          return fn(innerContent)
        }, <InnerApp />)}
      </AppContainerWithIsomorphicFiberStructure>
    )
  }

  /**
   * Rules of Static & Dynamic HTML:
   *
   *    1.) We must generate static HTML unless the caller explicitly opts
   *        in to dynamic HTML support.
   *
   *    2.) If dynamic HTML support is requested, we must honor that request
   *        or throw an error. It is the sole responsibility of the caller to
   *        ensure they aren't e.g. requesting dynamic HTML for an AMP page.
   *
   * These rules help ensure that other existing features like request caching,
   * coalescing, and ISR continue working as intended.
   */
  const generateStaticHTML = supportsDynamicHTML !== true
  const renderDocument = async () => {
    if (process.browser && Document.getInitialProps) {
      throw new Error(
        '`getInitialProps` in Document component is not supported with `concurrentFeatures` enabled.'
      )
    }
    if (!process.browser && Document.getInitialProps) {
      const renderPage: RenderPage = (
        options: ComponentsEnhancer = {}
      ): RenderPageResult | Promise<RenderPageResult> => {
        if (ctx.err && ErrorDebug) {
          const html = ReactDOMServer.renderToString(
            <Body>
              <ErrorDebug error={ctx.err} />
            </Body>
          )
          return { html, head }
        }

        if (dev && (props.router || props.Component)) {
          throw new Error(
            `'router' and 'Component' can not be returned in getInitialProps from _app.js https://nextjs.org/docs/messages/cant-override-next-props`
          )
        }

        const { App: EnhancedApp, Component: EnhancedComponent } =
          enhanceComponents(options, App, Component)

        const html = ReactDOMServer.renderToString(
          <Body>
            {getWrappedApp(
              <EnhancedApp
                Component={EnhancedComponent}
                router={router}
                {...props}
              />
            )}
          </Body>
        )
        return { html, head }
      }
      const documentCtx = { ...ctx, renderPage }
      const docProps: DocumentInitialProps = await loadGetInitialProps(
        Document,
        documentCtx
      )
      // the response might be finished on the getInitialProps call
      if (isResSent(res) && !isSSG) return null

      if (!docProps || typeof docProps.html !== 'string') {
        const message = `"${getDisplayName(
          Document
        )}.getInitialProps()" should resolve to an object with a "html" prop set with a valid html string`
        throw new Error(message)
      }

      return {
        bodyResult: () => piperFromArray([docProps.html]),
        documentElement: (htmlProps: HtmlProps) => (
          <Document {...htmlProps} {...docProps} />
        ),
        useMainContent: (fn?: (content: JSX.Element) => JSX.Element) => {
          if (fn) {
            throw new Error(
              'The `children` property is not supported by non-functional custom Document components'
            )
          }
          // @ts-ignore
          return <next-js-internal-body-render-target />
        },
        head: docProps.head,
        headTags: await headTags(documentCtx),
        styles: docProps.styles,
      }
    } else {
      let bodyResult

      if (concurrentFeatures) {
        bodyResult = async () => {
          // this must be called inside bodyResult so appWrappers is
          // up to date when getWrappedApp is called
          const content =
            ctx.err && ErrorDebug ? (
              <Body>
                <ErrorDebug error={ctx.err} />
              </Body>
            ) : (
              <Body>
                {getWrappedApp(
                  <App {...props} Component={Component} router={router} />
                )}
              </Body>
            )
          return process.browser
            ? await renderToWebStream(content)
            : await renderToNodeStream(content, generateStaticHTML)
        }
      } else {
        const content =
          ctx.err && ErrorDebug ? (
            <Body>
              <ErrorDebug error={ctx.err} />
            </Body>
          ) : (
            <Body>
              {getWrappedApp(
                <App {...props} Component={Component} router={router} />
              )}
            </Body>
          )
        // for non-concurrent rendering we need to ensure App is rendered
        // before _document so that updateHead is called/collected before
        // rendering _document's head
        const result = piperFromArray([ReactDOMServer.renderToString(content)])
        bodyResult = () => result
      }

      return {
        bodyResult,
        documentElement: () => (Document as any)(),
        useMainContent: (fn?: (_content: JSX.Element) => JSX.Element) => {
          if (fn) {
            appWrappers.push(fn)
          }
          // @ts-ignore
          return <next-js-internal-body-render-target />
        },
        head,
        headTags: [],
        styles: jsxStyleRegistry.styles(),
      }
    }
  }

  const documentResult = await renderDocument()
  if (!documentResult) {
    return null
  }

  const dynamicImportsIds = new Set<string | number>()
  const dynamicImports = new Set<string>()

  for (const mod of reactLoadableModules) {
    const manifestItem: ManifestItem = reactLoadableManifest[mod]

    if (manifestItem) {
      dynamicImportsIds.add(manifestItem.id)
      manifestItem.files.forEach((item) => {
        dynamicImports.add(item)
      })
    }
  }

  const hybridAmp = ampState.hybrid
  const docComponentsRendered: DocumentProps['docComponentsRendered'] = {}

  const {
    assetPrefix,
    buildId,
    customServer,
    defaultLocale,
    disableOptimizedLoading,
    domainLocales,
    locale,
    locales,
    runtimeConfig,
  } = renderOpts
  const htmlProps: any = {
    __NEXT_DATA__: {
      props, // The result of getInitialProps
      page: pathname, // The rendered page
      query, // querystring parsed / passed by the user
      buildId, // buildId is used to facilitate caching of page bundles, we send it to the client so that pageloader knows where to load bundles
      assetPrefix: assetPrefix === '' ? undefined : assetPrefix, // send assetPrefix to the client side when configured, otherwise don't sent in the resulting HTML
      runtimeConfig, // runtimeConfig if provided, otherwise don't sent in the resulting HTML
      nextExport: nextExport === true ? true : undefined, // If this is a page exported by `next export`
      autoExport: isAutoExport === true ? true : undefined, // If this is an auto exported page
      isFallback,
      dynamicIds:
        dynamicImportsIds.size === 0
          ? undefined
          : Array.from(dynamicImportsIds),
      err: renderOpts.err ? serializeError(dev, renderOpts.err) : undefined, // Error if one happened, otherwise don't sent in the resulting HTML
      gsp: !!getStaticProps ? true : undefined, // whether the page is getStaticProps
      gssp: !!getServerSideProps ? true : undefined, // whether the page is getServerSideProps
      rsc: isServerComponent ? true : undefined, // whether the page is a server components page
      customServer, // whether the user is using a custom server
      gip: hasPageGetInitialProps ? true : undefined, // whether the page has getInitialProps
      appGip: !defaultAppGetInitialProps ? true : undefined, // whether the _app has getInitialProps
      locale,
      locales,
      defaultLocale,
      domainLocales,
      isPreview: isPreview === true ? true : undefined,
    },
    buildManifest: filteredBuildManifest,
    docComponentsRendered,
    dangerousAsPath: router.asPath,
    canonicalBase:
      !renderOpts.ampPath && getRequestMeta(req, '__nextStrippedLocale')
        ? `${renderOpts.canonicalBase || ''}/${renderOpts.locale}`
        : renderOpts.canonicalBase,
    ampPath,
    inAmpMode,
    isDevelopment: !!dev,
    hybridAmp,
    dynamicImports: Array.from(dynamicImports),
    assetPrefix,
    // Only enabled in production as development mode has features relying on HMR (style injection for example)
    unstable_runtimeJS:
      process.env.NODE_ENV === 'production'
        ? pageConfig.unstable_runtimeJS
        : undefined,
    unstable_JsPreload: pageConfig.unstable_JsPreload,
    devOnlyCacheBusterQueryString,
    scriptLoader,
    locale,
    disableOptimizedLoading,
    head: documentResult.head,
    headTags: documentResult.headTags,
    styles: documentResult.styles,
    useMainContent: documentResult.useMainContent,
    useMaybeDeferContent,
  }

  const document = (
    <AmpStateContext.Provider value={ampState}>
      <HtmlContext.Provider value={htmlProps}>
        {documentResult.documentElement(htmlProps)}
      </HtmlContext.Provider>
    </AmpStateContext.Provider>
  )

  let documentHTML: string
  if (process.browser) {
    // There is no `renderToStaticMarkup` exposed in the web environment, use
    // blocking `renderToReadableStream` to get the similar result.
    let result = ''
    const readable = (ReactDOMServer as any).renderToReadableStream(document, {
      onError: (e: any) => {
        throw e
      },
    })
    const reader = readable.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      result += typeof value === 'string' ? value : decoder.decode(value)
    }
    documentHTML = result
  } else {
    documentHTML = ReactDOMServer.renderToStaticMarkup(document)
  }

  const nonRenderedComponents = []
  const expectedDocComponents = ['Main', 'Head', 'NextScript', 'Html']

  for (const comp of expectedDocComponents) {
    if (!(docComponentsRendered as any)[comp]) {
      nonRenderedComponents.push(comp)
    }
  }

  if (nonRenderedComponents.length) {
    const missingComponentList = nonRenderedComponents
      .map((e) => `<${e} />`)
      .join(', ')
    const plural = nonRenderedComponents.length !== 1 ? 's' : ''
    throw new Error(
      `Your custom Document (pages/_document) did not render all the required subcomponent${plural}.\n` +
        `Missing component${plural}: ${missingComponentList}\n` +
        'Read how to fix here: https://nextjs.org/docs/messages/missing-document-component'
    )
  }

  const [renderTargetPrefix, renderTargetSuffix] = documentHTML.split(
    /<next-js-internal-body-render-target><\/next-js-internal-body-render-target>/
  )
  const prefix: Array<string> = []
  if (!documentHTML.startsWith(DOCTYPE)) {
    prefix.push(DOCTYPE)
  }
  prefix.push(renderTargetPrefix)
  if (inAmpMode) {
    prefix.push('<!-- __NEXT_DATA__ -->')
  }

  let pipers: Array<NodeWritablePiper> = [
    piperFromArray(prefix),
    await documentResult.bodyResult(),
    piperFromArray([renderTargetSuffix]),
  ]

  const postProcessors: Array<((html: string) => Promise<string>) | null> = (
    generateStaticHTML
      ? [
          inAmpMode
            ? async (html: string) => {
                html = await optimizeAmp(html, renderOpts.ampOptimizerConfig)
                if (!renderOpts.ampSkipValidation && renderOpts.ampValidator) {
                  await renderOpts.ampValidator(html, pathname)
                }
                return html
              }
            : null,
          !process.browser &&
          (process.env.__NEXT_OPTIMIZE_FONTS ||
            process.env.__NEXT_OPTIMIZE_IMAGES)
            ? async (html: string) => {
                return await postProcess(
                  html,
                  { getFontDefinition },
                  {
                    optimizeFonts: renderOpts.optimizeFonts,
                    optimizeImages: renderOpts.optimizeImages,
                  }
                )
              }
            : null,
          !process.browser && renderOpts.optimizeCss
            ? async (html: string) => {
                // eslint-disable-next-line import/no-extraneous-dependencies
                const Critters = require('critters')
                const cssOptimizer = new Critters({
                  ssrMode: true,
                  reduceInlineStyles: false,
                  path: renderOpts.distDir,
                  publicPath: `${renderOpts.assetPrefix}/_next/`,
                  preload: 'media',
                  fonts: false,
                  ...renderOpts.optimizeCss,
                })
                return await cssOptimizer.process(html)
              }
            : null,
          inAmpMode || hybridAmp
            ? async (html: string) => {
                return html.replace(/&amp;amp=1/g, '&amp=1')
              }
            : null,
        ]
      : []
  ).filter(Boolean)

  if (generateStaticHTML || postProcessors.length > 0) {
    let html = await piperToString(chainPipers(pipers))
    for (const postProcessor of postProcessors) {
      if (postProcessor) {
        html = await postProcessor(html)
      }
    }
    return new RenderResult(html)
  }

  return new RenderResult(chainPipers(pipers))
}

function errorToJSON(err: Error) {
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
    middleware: (err as any).middleware,
  }
}

function serializeError(
  dev: boolean | undefined,
  err: Error
): Error & { statusCode?: number } {
  if (dev) {
    return errorToJSON(err)
  }

  return {
    name: 'Internal Server Error.',
    message: '500 - Internal Server Error.',
    statusCode: 500,
  }
}

function renderToNodeStream(
  element: React.ReactElement,
  generateStaticHTML: boolean
): Promise<NodeWritablePiper> {
  return new Promise((resolve, reject) => {
    let underlyingStream: {
      resolve: (error?: Error) => void
      writable: WritableType
      queuedCallbacks: Array<() => void>
    } | null = null

    const stream = new Writable({
      // Use the buffer from the underlying stream
      highWaterMark: 0,
      writev(chunks, callback) {
        let str = ''
        for (let { chunk } of chunks) {
          str += chunk.toString()
        }

        if (!underlyingStream) {
          throw new Error(
            'invariant: write called without an underlying stream. This is a bug in Next.js'
          )
        }

        if (!underlyingStream.writable.write(str)) {
          underlyingStream.queuedCallbacks.push(() => callback())
        } else {
          callback()
        }
      },
    })
    stream.once('finish', () => {
      if (!underlyingStream) {
        throw new Error(
          'invariant: finish called without an underlying stream. This is a bug in Next.js'
        )
      }
      underlyingStream.resolve()
    })
    stream.once('error', (err) => {
      if (!underlyingStream) {
        throw new Error(
          'invariant: error called without an underlying stream. This is a bug in Next.js'
        )
      }
      underlyingStream.resolve(err)
    })
    // React uses `flush` to prevent stream middleware like gzip from buffering to the
    // point of harming streaming performance, so we make sure to expose it and forward it.
    // See: https://github.com/reactwg/react-18/discussions/91
    Object.defineProperty(stream, 'flush', {
      value: () => {
        if (!underlyingStream) {
          throw new Error(
            'invariant: flush called without an underlying stream. This is a bug in Next.js'
          )
        }
        if (typeof (underlyingStream.writable as any).flush === 'function') {
          ;(underlyingStream.writable as any).flush()
        }
      },
      enumerable: true,
    })

    let resolved = false
    const doResolve = (startWriting: any) => {
      if (!resolved) {
        resolved = true
        resolve((res, next) => {
          const drainHandler = () => {
            const prevCallbacks = underlyingStream!.queuedCallbacks
            underlyingStream!.queuedCallbacks = []
            prevCallbacks.forEach((callback) => callback())
          }
          res.on('drain', drainHandler)
          underlyingStream = {
            resolve: (err) => {
              underlyingStream = null
              res.removeListener('drain', drainHandler)
              next(err)
            },
            writable: res,
            queuedCallbacks: [],
          }
          startWriting()
        })
      }
    }

    const { abort, pipe } = (ReactDOMServer as any).renderToPipeableStream(
      element,
      {
        onError(error: Error) {
          if (!resolved) {
            resolved = true
            reject(error)
          }
          abort()
        },
        onCompleteShell() {
          if (!generateStaticHTML) {
            doResolve(() => pipe(stream))
          }
        },
        onCompleteAll() {
          doResolve(() => pipe(stream))
        },
      }
    )
  })
}

async function bufferedReadFromReadableStream(
  reader: ReadableStreamDefaultReader,
  writeFn: (val: string) => void
): Promise<void> {
  const decoder = new TextDecoder()
  let bufferedString = ''
  let pendingFlush: Promise<void> | null = null

  const flushBuffer = () => {
    if (!pendingFlush) {
      pendingFlush = new Promise((resolve) =>
        setTimeout(() => {
          writeFn(bufferedString)
          bufferedString = ''
          pendingFlush = null
          resolve()
        }, 0)
      )
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    bufferedString += typeof value === 'string' ? value : decoder.decode(value)
    flushBuffer()
  }

  // Make sure the promise resolves after any pending flushes
  await pendingFlush
}

function renderToWebStream(
  element: React.ReactElement
): Promise<NodeWritablePiper> {
  return new Promise((resolve, reject) => {
    let resolved = false
    const stream: ReadableStream = (
      ReactDOMServer as any
    ).renderToReadableStream(element, {
      onError(err: Error) {
        if (!resolved) {
          resolved = true
          reject(err)
        }
      },
      onCompleteShell() {
        if (!resolved) {
          resolved = true
          resolve((res, next) => {
            bufferedReadFromReadableStream(reader, (val) =>
              res.write(val)
            ).then(
              () => next(),
              (err) => next(err)
            )
          })
        }
      },
    })
    const reader = stream.getReader()
  })
}

function chainPipers(pipers: NodeWritablePiper[]): NodeWritablePiper {
  return pipers.reduceRight(
    (lhs, rhs) => (res, next) => {
      rhs(res, (err) => (err ? next(err) : lhs(res, next)))
    },
    (res, next) => {
      res.end()
      next()
    }
  )
}

function piperFromArray(chunks: string[]): NodeWritablePiper {
  return (res, next) => {
    if (typeof (res as any).cork === 'function') {
      res.cork()
    }
    chunks.forEach((chunk) => res.write(chunk))
    if (typeof (res as any).uncork === 'function') {
      res.uncork()
    }
    next()
  }
}

function piperToString(input: NodeWritablePiper): Promise<string> {
  return new Promise((resolve, reject) => {
    const bufferedChunks: Buffer[] = []
    const stream = new Writable({
      writev(chunks, callback) {
        chunks.forEach((chunk) => bufferedChunks.push(chunk.chunk))
        callback()
      },
    })
    input(stream, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve(Buffer.concat(bufferedChunks).toString())
      }
    })
  })
}

export function useMaybeDeferContent(
  _name: string,
  contentFn: () => JSX.Element
): [boolean, JSX.Element] {
  return [false, contentFn()]
}
