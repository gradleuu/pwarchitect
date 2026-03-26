#!/usr/bin/env bash

OUT="_textures.json"

mapfile -t files < <(find . -maxdepth 1 -type f -iname "*.png" -printf "%f\n" | sort)

{
  echo '{'
  echo '  "files": ['

  for i in "${!files[@]}"; do
    file="${files[$i]}"
    if [[ $i -lt $((${#files[@]} - 1)) ]]; then
      echo "    \"${file}\","
    else
      echo "    \"${file}\""
    fi
  done

  echo '  ]'
  echo '}'
} > "$OUT"
