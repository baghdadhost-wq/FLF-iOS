"""Make OpenLF2 find an LF2 installer shipped inside the iOS app bundle (full offline build)."""
import sys, pathlib

src = pathlib.Path(sys.argv[1]) / "src/app/application.cpp"
s = src.read_text()

helper = r'''
#if defined(__APPLE__)
#include <mach-o/dyld.h>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <system_error>
namespace {
// Full build: LF2_v2.0a.exe (or lf2_v20a_Setup.exe) is shipped next to the executable in the app bundle.
std::optional<std::filesystem::path> openlf2_bundled_installer() {
    char buffer[4096];
    std::uint32_t size = sizeof(buffer);
    if (_NSGetExecutablePath(buffer, &size) != 0) return std::nullopt;
    const auto dir = std::filesystem::path(buffer).parent_path();
    for (const char* name : {"LF2_v2.0a.exe", "lf2_v20a_Setup.exe"}) {
        std::error_code error;
        auto candidate = dir / name;
        if (std::filesystem::is_regular_file(candidate, error)) return candidate;
    }
    return std::nullopt;
}
}
#endif
'''

anchor = "    auto found = find_installer(directory);\n    if (!found || *found) return found;\n"
if anchor not in s:
    sys.exit("patch.py: anchor not found in application.cpp (OpenLF2 changed)")
s = s.replace(anchor, anchor + "#if defined(__APPLE__)\n    if (auto bundled = openlf2_bundled_installer()) return std::optional{*bundled};\n#endif\n", 1)

# put the helper just before the engine's own namespace (outside any #ifdef)
marker = "\nnamespace openlf2 {\n"
if marker not in s:
    sys.exit("patch.py: namespace marker not found")
s = s.replace(marker, "\n" + helper + marker, 1)
src.write_text(s)
print("patched", src)
