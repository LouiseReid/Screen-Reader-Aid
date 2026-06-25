#include <napi.h>
#include <string>
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

// Returns whether this process is currently trusted for the macOS
// Accessibility API (System Settings > Privacy & Security > Accessibility).
Napi::Value IsTrusted(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool trusted = AXIsProcessTrusted();
  return Napi::Boolean::New(env, trusted);
}

static Napi::Value CFStringToNapi(Napi::Env env, CFStringRef str) {
  if (str == nullptr) {
    return env.Null();
  }
  CFIndex length = CFStringGetLength(str);
  CFIndex maxSize =
      CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
  std::string buffer(maxSize, '\0');
  if (CFStringGetCString(str, &buffer[0], maxSize, kCFStringEncodingUTF8)) {
    return Napi::String::New(env, buffer.c_str());
  }
  return env.Null();
}

// Reads a single AX attribute and converts common Core Foundation types
// (string / bool / number) into a JS value, falling back to a description.
static Napi::Value CopyAttr(Napi::Env env, AXUIElementRef element,
                            CFStringRef attr) {
  CFTypeRef value = nullptr;
  AXError err = AXUIElementCopyAttributeValue(element, attr, &value);
  if (err != kAXErrorSuccess || value == nullptr) {
    return env.Null();
  }

  Napi::Value result = env.Null();
  CFTypeID typeID = CFGetTypeID(value);
  if (typeID == CFStringGetTypeID()) {
    result = CFStringToNapi(env, (CFStringRef)value);
  } else if (typeID == CFBooleanGetTypeID()) {
    result = Napi::Boolean::New(env, CFBooleanGetValue((CFBooleanRef)value));
  } else if (typeID == CFNumberGetTypeID()) {
    double d = 0;
    CFNumberGetValue((CFNumberRef)value, kCFNumberDoubleType, &d);
    result = Napi::Number::New(env, d);
  } else {
    CFStringRef desc = CFCopyDescription(value);
    result = CFStringToNapi(env, desc);
    if (desc != nullptr) {
      CFRelease(desc);
    }
  }

  CFRelease(value);
  return result;
}

// Reads the currently focused UI element (across all apps) and returns its
// core accessibility attributes as a plain object.
Napi::Value GetFocusedElement(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);

  // Unlock the frontmost app's accessibility tree FIRST. Chromium/WebKit
  // (Chrome, Electron, Safari, etc.) do not expose a focused element at all
  // until AXManualAccessibility / AXEnhancedUserInterface is set, so we cannot
  // discover the pid by reading the focused element. Instead we get the
  // frontmost app from NSWorkspace and unlock it before querying. Setting these
  // attributes on a regular native app is a harmless no-op.
  pid_t frontPid = 0;
  std::string frontBundleId;
  std::string frontAppName;
  @autoreleasepool {
    NSRunningApplication* front =
        [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (front != nil) {
      frontPid = front.processIdentifier;
      if (front.bundleIdentifier != nil) {
        frontBundleId = std::string([front.bundleIdentifier UTF8String]);
      }
      if (front.localizedName != nil) {
        frontAppName = std::string([front.localizedName UTF8String]);
      }
    }
  }
  if (!frontBundleId.empty()) {
    out.Set("bundleId", Napi::String::New(env, frontBundleId));
  }
  if (!frontAppName.empty()) {
    out.Set("appName", Napi::String::New(env, frontAppName));
  }
  if (frontPid > 0) {
    out.Set("pid", Napi::Number::New(env, frontPid));
    AXUIElementRef appRef = AXUIElementCreateApplication(frontPid);
    if (appRef != nullptr) {
      AXUIElementSetAttributeValue(appRef, CFSTR("AXManualAccessibility"),
                                   kCFBooleanTrue);
      AXUIElementSetAttributeValue(appRef, CFSTR("AXEnhancedUserInterface"),
                                   kCFBooleanTrue);
      CFRelease(appRef);
    }
  }

  AXUIElementRef systemWide = AXUIElementCreateSystemWide();
  if (systemWide == nullptr) {
    out.Set("error",
            Napi::String::New(env, "Could not create system-wide element"));
    return out;
  }

  AXUIElementRef focused = nullptr;
  AXError err = AXUIElementCopyAttributeValue(
      systemWide, kAXFocusedUIElementAttribute, (CFTypeRef*)&focused);
  CFRelease(systemWide);

  if (err != kAXErrorSuccess || focused == nullptr) {
    out.Set("error",
            Napi::String::New(
                env,
                "No focused element (if this is Chrome, the AX tree may still "
                "be loading \u2014 press the shortcut again)"));
    return out;
  }

  out.Set("role", CopyAttr(env, focused, kAXRoleAttribute));
  out.Set("subrole", CopyAttr(env, focused, kAXSubroleAttribute));
  out.Set("roleDescription",
          CopyAttr(env, focused, kAXRoleDescriptionAttribute));
  out.Set("title", CopyAttr(env, focused, kAXTitleAttribute));
  out.Set("value", CopyAttr(env, focused, kAXValueAttribute));
  out.Set("description", CopyAttr(env, focused, kAXDescriptionAttribute));
  out.Set("help", CopyAttr(env, focused, kAXHelpAttribute));
  out.Set("enabled", CopyAttr(env, focused, kAXEnabledAttribute));
  out.Set("focused", CopyAttr(env, focused, kAXFocusedAttribute));

  CFRelease(focused);
  return out;
}

// ---------------------------------------------------------------------------
// Live focus tracking
// ---------------------------------------------------------------------------

// Plain (non-N-API) representation so we can read attributes on the run-loop
// thread and hand the data to JS via a thread-safe function.
struct FocusedData {
  bool ok = false;
  std::string error;
  int pid = 0;
  std::string bundleId;
  std::string appName;
  std::string role;
  std::string subrole;
  std::string roleDescription;
  std::string title;
  std::string value;
  std::string description;
  std::string help;
  std::string enabled;
  std::string focused;
};

static std::string CFStringToStd(CFStringRef str) {
  if (str == nullptr) {
    return "";
  }
  CFIndex length = CFStringGetLength(str);
  CFIndex maxSize =
      CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
  std::string buffer(maxSize, '\0');
  if (CFStringGetCString(str, &buffer[0], maxSize, kCFStringEncodingUTF8)) {
    return std::string(buffer.c_str());
  }
  return "";
}

static std::string CopyAttrStd(AXUIElementRef element, CFStringRef attr) {
  CFTypeRef value = nullptr;
  if (AXUIElementCopyAttributeValue(element, attr, &value) != kAXErrorSuccess ||
      value == nullptr) {
    return "";
  }
  std::string result;
  CFTypeID typeID = CFGetTypeID(value);
  if (typeID == CFStringGetTypeID()) {
    result = CFStringToStd((CFStringRef)value);
  } else if (typeID == CFBooleanGetTypeID()) {
    result = CFBooleanGetValue((CFBooleanRef)value) ? "true" : "false";
  } else if (typeID == CFNumberGetTypeID()) {
    double d = 0;
    CFNumberGetValue((CFNumberRef)value, kCFNumberDoubleType, &d);
    result = std::to_string(d);
  } else {
    CFStringRef desc = CFCopyDescription(value);
    result = CFStringToStd(desc);
    if (desc != nullptr) {
      CFRelease(desc);
    }
  }
  CFRelease(value);
  return result;
}

static FocusedData ReadElement(AXUIElementRef element) {
  FocusedData data;
  if (element == nullptr) {
    data.error = "No focused element";
    return data;
  }
  pid_t pid = 0;
  if (AXUIElementGetPid(element, &pid) == kAXErrorSuccess) {
    data.pid = (int)pid;
    @autoreleasepool {
      NSRunningApplication* app =
          [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
      if (app != nil) {
        if (app.bundleIdentifier != nil) {
          data.bundleId = std::string([app.bundleIdentifier UTF8String]);
        }
        if (app.localizedName != nil) {
          data.appName = std::string([app.localizedName UTF8String]);
        }
      }
    }
  }
  data.role = CopyAttrStd(element, kAXRoleAttribute);
  data.subrole = CopyAttrStd(element, kAXSubroleAttribute);
  data.roleDescription = CopyAttrStd(element, kAXRoleDescriptionAttribute);
  data.title = CopyAttrStd(element, kAXTitleAttribute);
  data.value = CopyAttrStd(element, kAXValueAttribute);
  data.description = CopyAttrStd(element, kAXDescriptionAttribute);
  data.help = CopyAttrStd(element, kAXHelpAttribute);
  data.enabled = CopyAttrStd(element, kAXEnabledAttribute);
  data.focused = CopyAttrStd(element, kAXFocusedAttribute);
  data.ok = true;
  return data;
}

static Napi::Object BuildObject(Napi::Env env, const FocusedData& data) {
  Napi::Object out = Napi::Object::New(env);
  if (!data.error.empty()) {
    out.Set("error", Napi::String::New(env, data.error));
    if (data.pid != 0) {
      out.Set("pid", Napi::Number::New(env, data.pid));
    }
    return out;
  }
  auto setStr = [&](const char* key, const std::string& v) {
    if (v.empty()) {
      out.Set(key, env.Null());
    } else {
      out.Set(key, Napi::String::New(env, v));
    }
  };
  setStr("role", data.role);
  setStr("subrole", data.subrole);
  setStr("roleDescription", data.roleDescription);
  setStr("title", data.title);
  setStr("value", data.value);
  setStr("description", data.description);
  setStr("help", data.help);
  setStr("enabled", data.enabled);
  setStr("focused", data.focused);
  if (data.pid != 0) {
    out.Set("pid", Napi::Number::New(env, data.pid));
  }
  if (!data.bundleId.empty()) {
    out.Set("bundleId", Napi::String::New(env, data.bundleId));
  }
  if (!data.appName.empty()) {
    out.Set("appName", Napi::String::New(env, data.appName));
  }
  return out;
}

static void UnlockApp(pid_t pid) {
  AXUIElementRef appRef = AXUIElementCreateApplication(pid);
  if (appRef != nullptr) {
    AXUIElementSetAttributeValue(appRef, CFSTR("AXManualAccessibility"),
                                 kCFBooleanTrue);
    AXUIElementSetAttributeValue(appRef, CFSTR("AXEnhancedUserInterface"),
                                 kCFBooleanTrue);
    CFRelease(appRef);
  }
}

static Napi::ThreadSafeFunction g_tsfn;
static AXObserverRef g_observer = nullptr;
static AXUIElementRef g_observedApp = nullptr;
static pid_t g_observedPid = 0;
static id g_wsObserver = nil;
static bool g_tracking = false;

static void PushFocused(const FocusedData& data) {
  if (!g_tracking) {
    return;
  }
  FocusedData* payload = new FocusedData(data);
  napi_status status = g_tsfn.NonBlockingCall(
      payload,
      [](Napi::Env env, Napi::Function jsCallback, FocusedData* item) {
        jsCallback.Call({BuildObject(env, *item)});
        delete item;
      });
  if (status != napi_ok) {
    delete payload;
  }
}

static void PushCurrentFocus() {
  AXUIElementRef systemWide = AXUIElementCreateSystemWide();
  if (systemWide == nullptr) {
    return;
  }
  AXUIElementRef focused = nullptr;
  AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute,
                                (CFTypeRef*)&focused);
  CFRelease(systemWide);
  if (focused != nullptr) {
    FocusedData data = ReadElement(focused);
    CFRelease(focused);
    PushFocused(data);
  }
}

static void AXFocusCallback(AXObserverRef observer, AXUIElementRef element,
                            CFStringRef notification, void* refcon) {
  PushCurrentFocus();
}

static void DetachObserver() {
  if (g_observer != nullptr) {
    if (g_observedApp != nullptr) {
      AXObserverRemoveNotification(g_observer, g_observedApp,
                                   kAXFocusedUIElementChangedNotification);
      AXObserverRemoveNotification(g_observer, g_observedApp,
                                   kAXFocusedWindowChangedNotification);
    }
    CFRunLoopRemoveSource(CFRunLoopGetMain(),
                          AXObserverGetRunLoopSource(g_observer),
                          kCFRunLoopDefaultMode);
    CFRelease(g_observer);
    g_observer = nullptr;
  }
  if (g_observedApp != nullptr) {
    CFRelease(g_observedApp);
    g_observedApp = nullptr;
  }
  g_observedPid = 0;
}

static void AttachObserver(pid_t pid) {
  if (pid <= 0) {
    return;
  }
  UnlockApp(pid);

  AXObserverRef observer = nullptr;
  if (AXObserverCreate(pid, AXFocusCallback, &observer) != kAXErrorSuccess ||
      observer == nullptr) {
    return;
  }
  AXUIElementRef appRef = AXUIElementCreateApplication(pid);
  if (appRef == nullptr) {
    CFRelease(observer);
    return;
  }
  AXObserverAddNotification(observer, appRef,
                            kAXFocusedUIElementChangedNotification, nullptr);
  AXObserverAddNotification(observer, appRef,
                            kAXFocusedWindowChangedNotification, nullptr);
  CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer),
                     kCFRunLoopDefaultMode);

  g_observer = observer;
  g_observedApp = appRef;
  g_observedPid = pid;

  PushCurrentFocus();
}

Napi::Value StartFocusTracking(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_tracking) {
    return Napi::Boolean::New(env, true);
  }
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected a callback function")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  g_tsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(),
                                         "FocusTracker", 0, 1);
  g_tracking = true;

  pid_t frontPid = 0;
  NSRunningApplication* front =
      [[NSWorkspace sharedWorkspace] frontmostApplication];
  if (front != nil) {
    frontPid = front.processIdentifier;
  }
  AttachObserver(frontPid);

  // Re-attach to the new frontmost app whenever the user switches apps.
  g_wsObserver = [[[NSWorkspace sharedWorkspace] notificationCenter]
      addObserverForName:NSWorkspaceDidActivateApplicationNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification* note) {
                NSRunningApplication* app =
                    note.userInfo[NSWorkspaceApplicationKey];
                if (app == nil) {
                  return;
                }
                pid_t newPid = app.processIdentifier;
                if (newPid == g_observedPid) {
                  return;
                }
                DetachObserver();
                AttachObserver(newPid);
              }];

  return Napi::Boolean::New(env, true);
}

Napi::Value StopFocusTracking(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_tracking) {
    return Napi::Boolean::New(env, false);
  }
  g_tracking = false;
  if (g_wsObserver != nil) {
    [[[NSWorkspace sharedWorkspace] notificationCenter]
        removeObserver:g_wsObserver];
    g_wsObserver = nil;
  }
  DetachObserver();
  g_tsfn.Release();
  return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "isTrusted"),
              Napi::Function::New(env, IsTrusted));
  exports.Set(Napi::String::New(env, "getFocusedElement"),
              Napi::Function::New(env, GetFocusedElement));
  exports.Set(Napi::String::New(env, "startFocusTracking"),
              Napi::Function::New(env, StartFocusTracking));
  exports.Set(Napi::String::New(env, "stopFocusTracking"),
              Napi::Function::New(env, StopFocusTracking));
  return exports;
}

NODE_API_MODULE(addon, Init)
