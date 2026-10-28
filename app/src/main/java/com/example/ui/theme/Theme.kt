package com.example.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val WarmAcademicColorScheme = lightColorScheme(
    primary = TealPrimary,
    onPrimary = WarmPaper,
    primaryContainer = TealSoft,
    onPrimaryContainer = SlateInk,
    secondary = DeepSlateSecondary,
    onSecondary = WarmPaper,
    secondaryContainer = WarmMutedContainer,
    onSecondaryContainer = SlateInk,
    tertiary = AmberAccent,
    onTertiary = WarmPaper,
    tertiaryContainer = AmberSoft,
    onTertiaryContainer = SlateInk,
    background = WarmBackground,
    onBackground = SlateInk,
    surface = WarmPaper,
    onSurface = SlateInk,
    surfaceVariant = WarmMutedContainer,
    onSurfaceVariant = SlateMuted,
    outline = WarmBorder,
    error = DangerRed,
    errorContainer = DangerSoft
)

@Composable
fun MyApplicationTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = WarmAcademicColorScheme,
        typography = Typography,
        content = content
    )
}
