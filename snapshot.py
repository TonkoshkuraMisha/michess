import os


def sanitize_env(content: str) -> str:
    """Masks sensitive values in .env files to prevent credential leaks."""
    lines = content.splitlines()
    sanitized = []
    for line in lines:
        if "=" in line and not line.strip().startswith("#"):
            key, _ = line.split("=", 1)
            sanitized.append(f"{key}=***[HIDDEN]***")
        else:
            sanitized.append(line)
    return "\n".join(sanitized)


def create_snapshot():
    project_root = r"C:\Users\tonko\PycharmProjects\michess"
    output_file = os.path.join(project_root, "project_snapshot.txt")

    # Папки, которые полностью исключаются из обхода
    ignore_dirs = {
        ".git",
        ".github",
        ".idea",
        "michess_env",
        "__pycache__",
        "venv",
        "alembic",
        "pgns",
        "bin",
        "node_modules",
        "dist",
        "build",
        ".vite",
        ".pytest_cache",
    }

    # Расширения файлов, содержимое которых не нужно выгружать
    ignore_exts = {
        ".pyc",
        ".pyo",
        ".pyd",
        ".exe",
        ".dll",
        ".so",
        ".whl",
        ".pgn",
        ".png",
        ".jpg",
        ".jpeg",
        ".mp3",
        ".ico",
        ".lock",
    }

    with open(output_file, "w", encoding="utf-8") as out:
        out.write("========================================\n")
        out.write("        PROJECT DIRECTORY TREE\n")
        out.write("========================================\n\n")

        # 1. Запись структуры дерева каталогов
        for root, dirs, files in os.walk(project_root):
            dirs[:] = [d for d in dirs if d not in ignore_dirs]
            level = root.replace(project_root, "").count(os.sep)
            indent = " " * 4 * level
            out.write(f"{indent}{os.path.basename(root)}/\n")
            subindent = " " * 4 * (level + 1)
            for f in files:
                if not any(f.endswith(ext) for ext in ignore_exts):
                    out.write(f"{subindent}{f}\n")

        out.write("\n\n========================================\n")
        out.write("             FILE CONTENTS\n")
        out.write("========================================\n")

        # 2. Запись содержимого файлов кода
        for root, dirs, files in os.walk(project_root):
            dirs[:] = [d for d in dirs if d not in ignore_dirs]
            for f_name in files:
                if (
                    any(f_name.endswith(ext) for ext in ignore_exts)
                    or f_name == "project_snapshot.txt"
                    or f_name == "snapshot.py"
                ):
                    continue

                file_path = os.path.join(root, f_name)
                rel_path = os.path.relpath(file_path, project_root)

                out.write(f"\n\n--- FILE: {rel_path} ---\n\n")
                try:
                    with open(file_path, "r", encoding="utf-8") as f_in:
                        content = f_in.read()
                        if f_name == ".env":
                            content = sanitize_env(content)
                        out.write(content)
                except Exception as e:
                    out.write(f"[Error reading file: {e}]\n")

    print(f"Project snapshot successfully created at: {output_file}")


if __name__ == "__main__":
    create_snapshot()