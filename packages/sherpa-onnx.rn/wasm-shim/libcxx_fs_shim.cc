// libcxx __fs::filesystem ABI shim
//
// Prebuilt onnxruntime wasm static libs (csukuangfj/onnxruntime-libs >=1.20.0)
// are compiled against a libc++ where `__fs` is an `inline namespace` inside
// `std::__2`, mangling symbols as `std::__2::__fs::filesystem::*`.
// emsdk 4.x ships libc++ with `_LIBCPP_ABI_NO_FILESYSTEM_INLINE_NAMESPACE`
// effectively defined (the static archive doesn't expose `__fs::*` symbols),
// so the linker fails with undefined-symbol errors for the four functions
// ORT actually calls. Because `inline namespace __fs` makes the types
// identical, providing forwarding functions whose mangled names use the
// missing `__fs::filesystem::*` form and which call into the emsdk libc++
// equivalents is ABI-safe — `path` has the same memory layout regardless of
// the inline-namespace alias.

#include <filesystem>
#include <string>
#include <system_error>

namespace fs = std::filesystem;

// Forward declare the actual emsdk libc++ entry points by mangled name.
extern "C" {
  void _ZNKSt3__210filesystem4path13__parent_pathEv(
      fs::path* sret, const fs::path* self);
  void _ZNKSt3__210filesystem4path10__filenameEv(
      fs::path* sret, const fs::path* self);
  void _ZNKSt3__210filesystem4path16__root_directoryEv(
      fs::path* sret, const fs::path* self);
  void _ZNSt3__210filesystem8__statusERKNS0_4pathEPNS_10error_codeE(
      fs::file_status* sret, const fs::path* p, std::error_code* ec);
}

// Provide the missing __fs::filesystem::* mangled symbols as forwarders.
// These mangled names match the ones emitted by a libc++ that has
// `inline namespace __fs { namespace filesystem { ... } }` enabled.
extern "C" {

void _ZNKSt3__24__fs10filesystem4path13__parent_pathEv(
    fs::path* sret, const fs::path* self) {
  _ZNKSt3__210filesystem4path13__parent_pathEv(sret, self);
}

void _ZNKSt3__24__fs10filesystem4path10__filenameEv(
    fs::path* sret, const fs::path* self) {
  _ZNKSt3__210filesystem4path10__filenameEv(sret, self);
}

void _ZNKSt3__24__fs10filesystem4path16__root_directoryEv(
    fs::path* sret, const fs::path* self) {
  _ZNKSt3__210filesystem4path16__root_directoryEv(sret, self);
}

void _ZNSt3__24__fs10filesystem8__statusERKNS1_4pathEPNS_10error_codeE(
    fs::file_status* sret, const fs::path* p, std::error_code* ec) {
  _ZNSt3__210filesystem8__statusERKNS0_4pathEPNS_10error_codeE(sret, p, ec);
}

}
