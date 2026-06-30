set action to button returned of (display dialog "Resume actions" buttons {"Cancel", "Open Downloads", "Update resume.pdf"} default button "Update resume.pdf" cancel button "Cancel")

if action is "Update resume.pdf" then
 makeResume()
else if action is "Open Downloads" then
 do shell script "open ~/Downloads"
end if

on makeResume()
 set downloadsFolder to path to downloads folder
 set downloadsPath to POSIX path of downloadsFolder

 set latestFile to do shell script "/bin/zsh -c " & quoted form of "
setopt null_glob

files=(\"$HOME/Downloads\"/cv-*.pdf)

if (( ${#files} == 0 )); then
  echo NO_FILES
  exit 0
fi

newest=\"${files[1]}\"

for f in \"${files[@]}\"; do
  if [[ \"$f\" -nt \"$newest\" ]]; then
    newest=\"$f\"
  fi
done

print -r -- \"$newest\"
"

 if latestFile is "NO_FILES" then
  display dialog "No cv-*.pdf found in Downloads" buttons {"OK"}
  return
 end if

 set targetFile to downloadsPath & "resume.pdf"

 try
  do shell script "cp -f " & quoted form of latestFile & " " & quoted form of targetFile

  tell application "Finder"
   set cvFiles to every file of downloadsFolder whose name starts with "cv-" and name ends with ".pdf"
   delete cvFiles
  end tell
 on error errMsg
  display dialog "Failed:" & return & errMsg buttons {"OK"}
 end try
end makeResume