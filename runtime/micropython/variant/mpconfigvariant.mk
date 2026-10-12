FROZEN_MANIFEST =

# Match the upstream standard variant: fixed-heap GC scans Wasm registers.
# Explicit Python GC inside driver methods must fit the instrumented C stack.
# Keep the fixed Python heap; this is bounded Asyncify unwind storage only.
# Optimize the linked/instrumented Wasm as well as the C compilation. Without
# link optimization Safari exhausts its call stack in ordinary driver calls.
JSFLAGS += -Os -s ASYNCIFY -s ASYNCIFY_STACK_SIZE=65536
