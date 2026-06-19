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
  @autoreleasepool {
    NSRunningApplication* front =
        [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (front != nil) {
      frontPid = front.processIdentifier;
    }
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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "isTrusted"),
              Napi::Function::New(env, IsTrusted));
  exports.Set(Napi::String::New(env, "getFocusedElement"),
              Napi::Function::New(env, GetFocusedElement));
  return exports;
}

NODE_API_MODULE(addon, Init)
