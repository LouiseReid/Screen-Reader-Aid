#include <napi.h>
#import <ApplicationServices/ApplicationServices.h>

// Returns whether this process is currently trusted for the macOS
// Accessibility API (System Settings > Privacy & Security > Accessibility).
Napi::Value IsTrusted(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  bool trusted = AXIsProcessTrusted();
  return Napi::Boolean::New(env, trusted);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "isTrusted"),
              Napi::Function::New(env, IsTrusted));
  return exports;
}

NODE_API_MODULE(addon, Init)
