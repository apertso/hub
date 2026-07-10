#Requires AutoHotkey v2.0

app := Gui()
app.Title := "Resume Helper"
app.SetFont("s10")

app.Add("Text",, "Resume actions")
app.Add("Button", "w300", "Update resume.pdf").OnEvent("Click", MakeResume)
app.Add("Button", "w300", "Open Downloads").OnEvent("Click", OpenDownloads)
app.Add("Button", "w300", "Copy cover letter prompt").OnEvent("Click", CopyCoverLetterPrompt)

app.Show()

MakeResume(*) {
    downloads := EnvGet("USERPROFILE") "\Downloads"
    target := downloads "\resume.pdf"

    latest := ""
    latestTime := 0

    Loop Files downloads "\cv-*.pdf" {
        if A_LoopFileTimeModified > latestTime {
            latestTime := A_LoopFileTimeModified
            latest := A_LoopFileFullPath
        }
    }

    if latest = "" {
        MsgBox "No cv-*.pdf found in Downloads"
        return
    }

    try {
        FileCopy latest, target, true

        Loop Files downloads "\cv-*.pdf" {
            FileRecycle A_LoopFileFullPath
        }
    } catch as err {
        MsgBox "Failed:`n" err.Message
    }
}

OpenDownloads(*) {
    downloads := EnvGet("USERPROFILE") "\Downloads"
    Run downloads
}

CopyCoverLetterPrompt(*) {
    A_Clipboard := "Give me a cover letter, but not in JSON. Use straight apostrophes."
}
