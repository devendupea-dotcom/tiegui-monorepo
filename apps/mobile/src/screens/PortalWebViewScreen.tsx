import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation, type WebViewProps } from "react-native-webview";
import * as ImagePicker from "expo-image-picker";

export type PortalWebViewRouteParams = {
  path: string;
  title: string;
};

const APP_DOMAIN = "tieguisolutions.com";
const DEFAULT_PORTAL_BASE_URL = "https://app.tieguisolutions.com";
const BRIDGE_SOURCE = "tiegui-native-photo-bridge";
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

type ScreenProps = {
  route: {
    params?: PortalWebViewRouteParams;
  };
};

type NativeBridgeAction = "signUpload" | "attachPhoto";

type PendingBridgeRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

function getPortalBaseUrl(): string {
  const fromAppConfig = process.env.EXPO_PUBLIC_PORTAL_BASE_URL;
  return (fromAppConfig || DEFAULT_PORTAL_BASE_URL).replace(/\/+$/, "");
}

function isNativeIntentUrl(url: string): boolean {
  return /^(tel:|sms:|mailto:)/i.test(url);
}

function isMapsUrl(url: string): boolean {
  if (/^(maps:|geo:)/i.test(url)) {
    return true;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host === "maps.apple.com" || host === "maps.google.com" || host === "maps.app.goo.gl") {
      return true;
    }
    if ((host === "google.com" || host.endsWith(".google.com")) && path.startsWith("/maps")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isTieGuiUrl(url: string): boolean {
  if (!/^https?:/i.test(url)) {
    return true;
  }
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === APP_DOMAIN || hostname.endsWith(`.${APP_DOMAIN}`);
  } catch {
    return false;
  }
}

async function openExternal(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.warn("Unable to open external URL", { url, error });
  }
}

function getMapsQuery(url: URL): string | null {
  const candidates = ["q", "query", "destination", "daddr", "address"];
  for (const key of candidates) {
    const value = url.searchParams.get(key);
    if (value && value.trim()) {
      return value.trim();
    }
  }

  if (url.pathname.includes("/place/")) {
    const placeSegment = url.pathname.split("/place/")[1]?.split("/")[0];
    if (placeSegment) {
      return decodeURIComponent(placeSegment).trim();
    }
  }

  return null;
}

async function openMaps(targetUrl: string): Promise<void> {
  if (/^(maps:|geo:)/i.test(targetUrl)) {
    await openExternal(targetUrl);
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    await openExternal(targetUrl);
    return;
  }

  const query = getMapsQuery(parsed);
  const latLng = parsed.searchParams.get("ll");

  if (Platform.OS === "android") {
    const geoUrl =
      query && query.length > 0
        ? `geo:0,0?q=${encodeURIComponent(query)}`
        : latLng
          ? `geo:${latLng}`
          : "geo:0,0";
    if (await Linking.canOpenURL(geoUrl)) {
      await openExternal(geoUrl);
      return;
    }
    await openExternal(targetUrl);
    return;
  }

  if (query) {
    const googleUrl = `comgooglemaps://?q=${encodeURIComponent(query)}`;
    if (await Linking.canOpenURL(googleUrl)) {
      await openExternal(googleUrl);
      return;
    }
  }

  const appleUrl = query
    ? `maps://?q=${encodeURIComponent(query)}`
    : latLng
      ? `maps://?ll=${encodeURIComponent(latLng)}`
      : "maps://";
  if (await Linking.canOpenURL(appleUrl)) {
    await openExternal(appleUrl);
    return;
  }

  await openExternal(targetUrl);
}

function buildPortalUrl(path: string): string {
  if (/^https?:/i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getPortalBaseUrl()}${normalizedPath}`;
}

function parseJobIdFromPortalUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/app\/(?:jobs|leads)\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function guessContentType(fileName: string | null | undefined): string | null {
  const lower = (fileName || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  return null;
}

function buildBridgeScript(action: NativeBridgeAction, payload: Record<string, unknown>, requestId: string): string {
  const actionJson = JSON.stringify(action);
  const payloadJson = JSON.stringify(payload);
  const requestIdJson = JSON.stringify(requestId);

  return `
    (function () {
      const action = ${actionJson};
      const payload = ${payloadJson};
      const requestId = ${requestIdJson};
      const source = "${BRIDGE_SOURCE}";

      const post = (data) => {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ source, requestId, action, ...data }));
        }
      };

      const parseResponse = async (response) => {
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      };

      const run = async () => {
        try {
          let response;
          if (action === "signUpload") {
            response = await fetch("/api/photos/sign-upload", {
              method: "POST",
              headers: { "content-type": "application/json" },
              credentials: "include",
              body: JSON.stringify(payload),
            });
          } else if (action === "attachPhoto") {
            response = await fetch("/api/jobs/" + encodeURIComponent(String(payload.jobId || "")) + "/photos", {
              method: "POST",
              headers: { "content-type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ photoId: payload.photoId, caption: payload.caption || "" }),
            });
          } else {
            throw new Error("Unknown bridge action");
          }

          const data = await parseResponse(response);
          const failed = !response.ok || (data && typeof data === "object" && data.ok === false);
          if (failed) {
            const error = data && typeof data === "object" && data.error ? String(data.error) : "Request failed.";
            throw new Error(error);
          }

          post({ ok: true, payload: data });
        } catch (error) {
          post({
            ok: false,
            error: error && typeof error === "object" && "message" in error ? String(error.message) : String(error),
          });
        }
      };

      run();
    })();
    true;
  `;
}

export default function PortalWebViewScreen({ route }: ScreenProps) {
  const params = route.params;
  const path = params?.path || "/app/today?mobile=1";
  const url = useMemo(() => buildPortalUrl(path), [path]);
  const webViewRef = useRef<WebView>(null);
  const pendingBridgeRequestsRef = useRef<Map<string, PendingBridgeRequest>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  const activeJobId = useMemo(() => parseJobIdFromPortalUrl(currentUrl), [currentUrl]);

  useEffect(() => {
    setCurrentUrl(url);
  }, [url]);

  useEffect(() => {
    if (!uploadNotice) {
      return;
    }
    const timeoutId = setTimeout(() => {
      setUploadNotice(null);
    }, 2600);
    return () => clearTimeout(timeoutId);
  }, [uploadNotice]);

  useEffect(
    () => () => {
      for (const pending of pendingBridgeRequestsRef.current.values()) {
        clearTimeout(pending.timeoutId);
        pending.reject(new Error("Bridge request canceled."));
      }
      pendingBridgeRequestsRef.current.clear();
    },
    [],
  );

  const handleExternalNavigation = useCallback((targetUrl: string): boolean => {
    if (!targetUrl) {
      return true;
    }

    if (isNativeIntentUrl(targetUrl)) {
      void openExternal(targetUrl);
      return false;
    }

    if (isMapsUrl(targetUrl)) {
      void openMaps(targetUrl);
      return false;
    }

    if (!isTieGuiUrl(targetUrl)) {
      void openExternal(targetUrl);
      return false;
    }

    return true;
  }, []);

  const handleShouldStartLoad = useCallback<NonNullable<WebViewProps["onShouldStartLoadWithRequest"]>>((request) => {
    const targetUrl = request.url || "";
    return handleExternalNavigation(targetUrl);
  }, [handleExternalNavigation]);

  const handleHttpError = useCallback((event: { nativeEvent: { statusCode: number } }) => {
    const status = event.nativeEvent.statusCode;
    if (status >= 400) {
      setErrorMessage(`Unable to load (${status}).`);
    }
  }, []);

  const handleNavigationStateChange = useCallback((state: WebViewNavigation) => {
    setCurrentUrl(state.url || url);
    if (state.loading) {
      setIsLoading(true);
    }
  }, [url]);

  const handleLoadEnd = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleError = useCallback(() => {
    setIsLoading(false);
    setErrorMessage("Couldn’t load this page.");
  }, []);

  const retry = useCallback(() => {
    setErrorMessage(null);
    setUploadNotice(null);
    setIsLoading(true);
    setRefreshNonce((value) => value + 1);
  }, []);

  const handleWebViewMessage = useCallback<NonNullable<WebViewProps["onMessage"]>>((event) => {
    const raw = event.nativeEvent.data;
    if (!raw) return;

    let message: {
      source?: string;
      requestId?: string;
      ok?: boolean;
      payload?: unknown;
      error?: string;
    };

    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message?.source !== BRIDGE_SOURCE || typeof message.requestId !== "string") {
      return;
    }

    const pending = pendingBridgeRequestsRef.current.get(message.requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeoutId);
    pendingBridgeRequestsRef.current.delete(message.requestId);

    if (message.ok) {
      pending.resolve(message.payload);
      return;
    }

    pending.reject(new Error(message.error || "Portal bridge request failed."));
  }, []);

  const callPortalBridge = useCallback(
    (action: NativeBridgeAction, payload: Record<string, unknown>) =>
      new Promise<unknown>((resolve, reject) => {
        if (!webViewRef.current) {
          reject(new Error("Portal view is not ready."));
          return;
        }

        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const timeoutId = setTimeout(() => {
          pendingBridgeRequestsRef.current.delete(requestId);
          reject(new Error("Timed out waiting for portal response."));
        }, 20000);

        pendingBridgeRequestsRef.current.set(requestId, { resolve, reject, timeoutId });
        webViewRef.current.injectJavaScript(buildBridgeScript(action, payload, requestId));
      }),
    [],
  );

  const pickAndUploadPhoto = useCallback(
    async (source: "camera" | "library") => {
      if (!activeJobId || isUploadingPhoto) {
        return;
      }

      try {
        const permission =
          source === "camera"
            ? await ImagePicker.requestCameraPermissionsAsync()
            : await ImagePicker.requestMediaLibraryPermissionsAsync();

        if (!permission.granted) {
          Alert.alert("Permission required", "Please allow photo access to upload job photos.");
          return;
        }

        const pickerResult =
          source === "camera"
            ? await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.85,
                allowsEditing: false,
              })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.85,
                allowsEditing: false,
                selectionLimit: 1,
              });

        if (pickerResult.canceled || !pickerResult.assets?.[0]) {
          return;
        }

        const asset = pickerResult.assets[0];
        const fileResponse = await fetch(asset.uri);
        const blob = await fileResponse.blob();
        const sizeBytes = blob.size || asset.fileSize || 0;
        const contentType = asset.mimeType || blob.type || guessContentType(asset.fileName) || "";

        if (!sizeBytes || sizeBytes <= 0) {
          throw new Error("Selected photo file is empty.");
        }

        if (sizeBytes > MAX_UPLOAD_BYTES) {
          throw new Error("Photo must be 12MB or smaller.");
        }

        if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
          throw new Error("Unsupported photo type. Use JPEG, PNG, WebP, or HEIC.");
        }

        setIsUploadingPhoto(true);
        setUploadNotice("Uploading photo…");

        const signPayload = (await callPortalBridge("signUpload", {
          leadId: activeJobId,
          contentType,
          sizeBytes,
          originalName: asset.fileName || `job-photo-${Date.now()}.jpg`,
        })) as {
          ok?: boolean;
          uploadUrl: string;
          photoId: string;
        };

        if (!signPayload?.uploadUrl || !signPayload?.photoId) {
          throw new Error("Upload signing failed.");
        }

        const uploadResponse = await fetch(signPayload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: blob,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed (${uploadResponse.status}).`);
        }

        await callPortalBridge("attachPhoto", {
          jobId: activeJobId,
          photoId: signPayload.photoId,
        });

        setUploadNotice("Photo added.");
        webViewRef.current?.reload();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed.";
        setUploadNotice(message);
      } finally {
        setIsUploadingPhoto(false);
      }
    },
    [activeJobId, callPortalBridge, isUploadingPhoto],
  );

  const showAddPhotoActions = useCallback(() => {
    if (!activeJobId || isUploadingPhoto) {
      return;
    }

    Alert.alert("Add photos", "Choose a photo source.", [
      { text: "Take Photo", onPress: () => void pickAndUploadPhoto("camera") },
      { text: "Choose from Library", onPress: () => void pickAndUploadPhoto("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [activeJobId, isUploadingPhoto, pickAndUploadPhoto]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.container}>
        {errorMessage ? (
          <View style={styles.errorState}>
            <Text style={styles.errorTitle}>Connection issue</Text>
            <Text style={styles.errorBody}>
              {errorMessage} Check your connection and try again.
            </Text>
            <Pressable style={styles.retryButton} onPress={retry}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <WebView
            key={`${url}-${refreshNonce}`}
            ref={webViewRef}
            source={{ uri: url }}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            domStorageEnabled
            javaScriptEnabled
            pullToRefreshEnabled
            originWhitelist={["*"]}
            setSupportMultipleWindows={false}
            allowsBackForwardNavigationGestures
            bounces={false}
            overScrollMode="never"
            onShouldStartLoadWithRequest={handleShouldStartLoad}
            onOpenWindow={(event) => {
              const targetUrl = event.nativeEvent.targetUrl;
              if (!targetUrl) {
                return;
              }
              if (isTieGuiUrl(targetUrl)) {
                webViewRef.current?.injectJavaScript(
                  `window.location.assign(${JSON.stringify(targetUrl)}); true;`,
                );
                return;
              }
              handleExternalNavigation(targetUrl);
            }}
            onNavigationStateChange={handleNavigationStateChange}
            onHttpError={handleHttpError}
            onError={handleError}
            onLoadEnd={handleLoadEnd}
            onMessage={handleWebViewMessage}
          />
        )}

        {isLoading && !errorMessage ? (
          <View pointerEvents="none" style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#c7a54b" />
            <Text style={styles.loadingLabel}>Loading…</Text>
          </View>
        ) : null}

        {activeJobId && !errorMessage ? (
          <View pointerEvents="box-none" style={styles.photoOverlayContainer}>
            {uploadNotice ? (
              <View style={styles.photoNotice}>
                <Text style={styles.photoNoticeText}>{uploadNotice}</Text>
              </View>
            ) : null}
            <Pressable
              style={[styles.addPhotoButton, isUploadingPhoto ? styles.addPhotoButtonDisabled : null]}
              onPress={showAddPhotoActions}
              disabled={isUploadingPhoto}
              accessibilityRole="button"
              accessibilityLabel={isUploadingPhoto ? "Uploading photo" : "Add photos"}
            >
              {isUploadingPhoto ? <ActivityIndicator size="small" color="#151515" /> : null}
              <Text style={styles.addPhotoButtonLabel}>
                {isUploadingPhoto ? "Uploading…" : "Add Photos"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0f1726",
  },
  container: {
    flex: 1,
    backgroundColor: "#0b111d",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(8, 15, 26, 0.3)",
  },
  loadingLabel: {
    color: "#eef2f9",
    fontSize: 14,
    fontWeight: "600",
  },
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
    backgroundColor: "#0b111d",
  },
  errorTitle: {
    color: "#f8fbff",
    fontSize: 20,
    fontWeight: "700",
  },
  errorBody: {
    color: "#a8b5c9",
    textAlign: "center",
    lineHeight: 22,
  },
  retryButton: {
    minHeight: 44,
    minWidth: 120,
    borderRadius: 12,
    backgroundColor: "#c7a54b",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    marginTop: 4,
  },
  retryLabel: {
    color: "#151515",
    fontWeight: "700",
    fontSize: 15,
  },
  photoOverlayContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "flex-end",
    paddingRight: 14,
    paddingBottom: 84,
    gap: 8,
  },
  addPhotoButton: {
    minHeight: 48,
    minWidth: 144,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#c7a54b",
    borderWidth: 1,
    borderColor: "rgba(199, 165, 75, 0.85)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  addPhotoButtonDisabled: {
    opacity: 0.82,
  },
  addPhotoButtonLabel: {
    color: "#151515",
    fontWeight: "700",
    fontSize: 14,
  },
  photoNotice: {
    maxWidth: 260,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(15, 23, 38, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(231, 239, 255, 0.22)",
  },
  photoNoticeText: {
    color: "#eaf0fa",
    fontSize: 12,
    lineHeight: 16,
  },
});
