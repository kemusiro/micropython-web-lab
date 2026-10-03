export const WEB_LAB_PDB_SOURCE = String.raw`
import sys as _pdb_sys
import json as _pdb_json
import _web_lab_debugger as _pdb_bridge

_pdb_main_globals = globals()

class Pdb:
    def __init__(self, *args, **kwargs):
        self._running = False
        self._source_lines = []
        self._mode = "continue"
        self._target_frame = None
        self._breakpoints = set()
        self._last_command = ""

    def set_trace(self, *args, **kwargs):
        if not self._running:
            raise RuntimeError("pdb.set_trace() はWeb Labのデバッグ実行で使用してください")
        self._mode = "step"
        self._target_frame = None

    def _trace(self, frame, event, arg):
        if frame.f_code.co_filename != "main.py":
            return self._trace

        should_stop = False
        if event == "line":
            if frame.f_lineno in self._breakpoints:
                should_stop = True
            elif self._mode == "step":
                should_stop = True
            elif self._mode == "next" and frame is self._target_frame:
                should_stop = True
        elif event == "return" and frame is self._target_frame:
            if self._mode in ("next", "return"):
                self._mode = "step"
                self._target_frame = None

        if should_stop:
            self._interaction(frame)
        return self._trace

    def _interaction(self, frame):
        self._mode = "continue"
        self._target_frame = None
        frames = []
        cursor = frame
        while cursor is not None:
            if cursor.f_code.co_filename == "main.py":
                frames.append(cursor)
            cursor = cursor.f_back
        selected = 0
        first_read = True
        self._print_location(frames[selected])

        while True:
            print("(Pdb) ", end="")
            command = _pdb_bridge.read_command(
                frame.f_code.co_filename,
                frame.f_lineno,
                frame.f_code.co_name,
                self._snapshot_globals(frame),
                first_read,
            ).strip()
            first_read = False
            if not command:
                command = self._last_command
            else:
                self._last_command = command
            if not command:
                continue

            name, separator, argument = command.partition(" ")
            name = name.lower()
            argument = argument.strip()

            if name in ("h", "help"):
                self._print_help()
            elif name in ("w", "where", "bt"):
                self._print_stack(frames, selected)
            elif name in ("l", "list"):
                self._print_source(frames[selected].f_lineno)
            elif name in ("u", "up"):
                if selected + 1 >= len(frames):
                    print("*** 最上位のフレームです")
                else:
                    selected += 1
                    self._print_location(frames[selected])
            elif name in ("d", "down"):
                if selected == 0:
                    print("*** 最下位のフレームです")
                else:
                    selected -= 1
                    self._print_location(frames[selected])
            elif name in ("b", "break"):
                self._break_command(argument)
            elif name in ("cl", "clear"):
                self._clear_command(argument)
            elif name in ("p", "pp"):
                self._evaluate(argument, frames[selected])
            elif name in ("a", "args"):
                print("*** この安定版ベースでは関数ローカル変数を取得できません")
            elif name.startswith("!"):
                self._execute(command[1:], frames[selected])
            elif name in ("s", "step"):
                self._mode = "step"
                _pdb_bridge.resumed()
                return
            elif name in ("n", "next"):
                self._mode = "next"
                self._target_frame = frames[selected]
                _pdb_bridge.resumed()
                return
            elif name in ("r", "return"):
                self._mode = "return"
                self._target_frame = frames[selected]
                _pdb_bridge.resumed()
                return
            elif name in ("c", "cont", "continue"):
                self._mode = "continue"
                _pdb_bridge.resumed()
                return
            elif name in ("q", "quit", "exit"):
                print("*** quitはWeb LabのWorker再生成として処理されます")
            else:
                self._evaluate(command, frames[selected])

    def _print_location(self, frame):
        print("> %s(%d)%s()" % (
            frame.f_code.co_filename,
            frame.f_lineno,
            frame.f_code.co_name,
        ))
        self._print_source_line(frame.f_lineno)

    def _print_source_line(self, line_number):
        if 1 <= line_number <= len(self._source_lines):
            print("-> %d\t%s" % (line_number, self._source_lines[line_number - 1]))

    def _print_source(self, current_line):
        start = max(1, current_line - 5)
        end = min(len(self._source_lines), current_line + 5)
        for line_number in range(start, end + 1):
            marker = "->" if line_number == current_line else "  "
            print("%s %d\t%s" % (
                marker,
                line_number,
                self._source_lines[line_number - 1],
            ))

    def _print_stack(self, frames, selected):
        for index in range(len(frames) - 1, -1, -1):
            frame = frames[index]
            marker = ">" if index == selected else " "
            print("%s %s(%d)%s()" % (
                marker,
                frame.f_code.co_filename,
                frame.f_lineno,
                frame.f_code.co_name,
            ))

    def _break_command(self, argument):
        if not argument:
            if not self._breakpoints:
                print("ブレークポイントはありません")
                return
            for line_number in sorted(self._breakpoints):
                print("breakpoint at main.py:%d" % line_number)
            return
        try:
            line_number = int(argument)
        except ValueError:
            print("*** breakには行番号を指定してください")
            return
        if line_number < 1 or line_number > len(self._source_lines):
            print("*** 行番号がソース範囲外です")
            return
        self._breakpoints.add(line_number)
        print("Breakpoint at main.py:%d" % line_number)

    def _clear_command(self, argument):
        if not argument:
            self._breakpoints.clear()
            print("Deleted all breakpoints")
            return
        try:
            line_number = int(argument)
        except ValueError:
            print("*** clearには行番号を指定してください")
            return
        self._breakpoints.discard(line_number)
        print("Deleted breakpoint at main.py:%d" % line_number)

    def _evaluate(self, expression, frame):
        if not expression:
            print("*** 評価する式を指定してください")
            return
        try:
            print(repr(eval(expression, frame.f_globals)))
        except Exception as error:
            print("*** %s: %s" % (type(error).__name__, error))

    def _execute(self, statement, frame):
        try:
            exec(statement, frame.f_globals)
        except Exception as error:
            print("*** %s: %s" % (type(error).__name__, error))

    def _snapshot_globals(self, frame):
        variables = []
        for name in sorted(frame.f_globals):
            if name in _pdb_reserved_globals or name.startswith("_pdb_"):
                continue
            try:
                value = frame.f_globals[name]
                type_name = type(value).__name__
                rendered = repr(value)
            except Exception as error:
                type_name = type(error).__name__
                rendered = "<repr failed: %s>" % error
            if len(rendered) > 256:
                rendered = rendered[:255] + "…"
            variables.append({
                "name": name[:128],
                "typeName": type_name[:64],
                "value": rendered,
            })
            if len(variables) >= 100:
                break
        return _pdb_json.dumps(variables)

    def _print_help(self):
        print("h(elp)             コマンド一覧")
        print("w(here)            スタックを表示")
        print("l(ist)             現在行の前後を表示")
        print("u(p) / d(own)      スタックフレームを移動")
        print("b(reak) [lineno]   ブレークポイントの表示・追加")
        print("cl(ear) [lineno]   ブレークポイントの削除")
        print("p expression       グローバル式を評価")
        print("s(tep)             次に実行する行で停止")
        print("n(ext)             現在の関数の次行で停止")
        print("r(eturn)           現在の関数から戻るまで実行")
        print("c(ontinue)         次のブレークポイントまで実行")
        print("q(uit)             Workerを再生成して終了")

    def _run(self, source, globals_dict=None, locals_dict=None):
        if globals_dict is None:
            globals_dict = _pdb_main_globals
        if locals_dict is None:
            locals_dict = globals_dict
        self._source_lines = source.split("\n")
        self._running = True
        self._mode = "step"
        self._target_frame = None
        self._breakpoints.clear()
        self._last_command = ""
        _pdb_sys.settrace(self._trace)
        try:
            code = compile(source, "main.py", "exec")
            exec(code, globals_dict, locals_dict)
        finally:
            self._running = False
            _pdb_sys.settrace(None)

    def run(self, statement, globals=None, locals=None):
        return self._run(statement, globals, locals)

    def runeval(self, expression, globals=None, locals=None):
        if globals is None:
            globals = _pdb_main_globals
        if locals is None:
            locals = globals
        return eval(expression, globals, locals)

    def runcall(self, function, *args, **kwargs):
        return function(*args, **kwargs)


_pdb_default = Pdb()

class _PdbModule:
    Pdb = Pdb

    def set_trace(self, *args, **kwargs):
        return _pdb_default.set_trace(*args, **kwargs)

    def run(self, statement, globals=None, locals=None):
        return _pdb_default.run(statement, globals, locals)

    def runeval(self, expression, globals=None, locals=None):
        return _pdb_default.runeval(expression, globals, locals)

    def runcall(self, function, *args, **kwargs):
        return _pdb_default.runcall(function, *args, **kwargs)

    def _run(self, source):
        return _pdb_default._run(source)


_pdb_sys.modules["pdb"] = _PdbModule()
_pdb_reserved_globals = set(globals())
`;
