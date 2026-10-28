package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Assignment
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.theme.*
import java.util.Calendar

enum class SchoolRole(val label: String, val badge: String) {
    ULTRA_ADMIN("Ultra Admin", "Platform Governance"),
    SUPER_ADMIN("Super Admin", "School & Campus Setup"),
    PRINCIPAL("Principal", "Academic & Moderation"),
    TEACHER("Teacher", "Classroom, DLP & AI Lessons"),
    FINANCE("Finance", "Campus Ledger & Payroll"),
    PARENT("Parent", "Verified Child & Fee Portal"),
    STUDENT("Student", "Learning, Homework & Quizzes")
}

data class SchoolTenant(
    val id: String,
    val name: String,
    val code: String,
    val status: String,
    val plan: String,
    val subscriptionStatus: String,
    val verification: String,
    val branches: Int,
    val staff: Int,
    val students: Int
)

data class DlpRecordItem(
    val id: String,
    val title: String,
    val subject: String,
    val classId: String,
    val section: String,
    val completionStatus: String,
    val completionDetails: String,
    val internalStaffNotes: String,
    val parentSummaryNotes: String,
    val principalStatus: String,
    val parentShareStatus: String,
    val version: Int
)

data class RecordedLessonItem(
    val id: String,
    val title: String,
    val subject: String,
    val classId: String,
    val sourceVersion: Int,
    val jobStatus: String,
    val summary: String,
    val revisionNotes: String,
    val teacherReviewed: Boolean,
    val published: Boolean
)

data class PrincipalApplicationItem(
    val id: String,
    val title: String,
    val category: String,
    val message: String,
    val status: String,
    val teacherName: String
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MyApplicationTheme {
                GreenwoodSchoolApp()
            }
        }
    }
}

private fun currentGreeting(): String {
    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    return when {
        hour in 5..11 -> "Good morning"
        hour in 12..16 -> "Good afternoon"
        else -> "Good evening"
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GreenwoodSchoolApp() {
    var activeRole by remember { mutableStateOf(SchoolRole.TEACHER) }
    var activeTab by remember { mutableStateOf("Home") }
    var noticeMessage by remember { mutableStateOf("") }

    var schools by remember {
        mutableStateOf(
            listOf(
                SchoolTenant(
                    id = "sch-1",
                    name = "Greenwood Academy Main",
                    code = "GWA",
                    status = "active",
                    plan = "GROWTH",
                    subscriptionStatus = "active_recorded",
                    verification = "recorded_only",
                    branches = 2,
                    staff = 42,
                    students = 680
                ),
                SchoolTenant(
                    id = "sch-2",
                    name = "Crescent Scholars Campus",
                    code = "CSC",
                    status = "active",
                    plan = "STARTER",
                    subscriptionStatus = "trial",
                    verification = "recorded_only",
                    branches = 1,
                    staff = 18,
                    students = 240
                )
            )
        )
    }

    var dlpList by remember {
        mutableStateOf(
            listOf(
                DlpRecordItem(
                    id = "dlp-1",
                    title = "Linear Equations & Modeling",
                    subject = "Mathematics",
                    classId = "Grade 9",
                    section = "A",
                    completionStatus = "completed",
                    completionDetails = "Completed examples 1-6; 24/26 students mastered exit ticket.",
                    internalStaffNotes = "CONFIDENTIAL STAFF NOTE: Schedule remedial coaching for 2 students.",
                    parentSummaryNotes = "Students practiced solving two-step linear equations in class today.",
                    principalStatus = "approved",
                    parentShareStatus = "shared_with_parents",
                    version = 1
                )
            )
        )
    }

    var recordedLessons by remember {
        mutableStateOf(
            listOf(
                RecordedLessonItem(
                    id = "rec-1",
                    title = "Cellular Respiration & ATP Synthesis",
                    subject = "Biology",
                    classId = "Grade 9 (A)",
                    sourceVersion = 1,
                    jobStatus = "ai_draft_ready",
                    summary = "Mitochondria convert glucose and oxygen into ATP through glycolysis, Krebs cycle, and electron transport.",
                    revisionNotes = "Equation: C6H12O6 + 6O2 -> 6CO2 + 6H2O + ATP",
                    teacherReviewed = true,
                    published = true
                )
            )
        )
    }

    var principalApps by remember {
        mutableStateOf(
            listOf(
                PrincipalApplicationItem(
                    id = "app-1",
                    title = "Science Lab Timetable Swap",
                    category = "timetable_request",
                    message = "Requesting Period 3 lab allocation for Grade 9 Biology practical.",
                    status = "submitted",
                    teacherName = "Sarah Wilson"
                )
            )
        )
    }

    if (activeTab != "Home") {
        BackHandler { activeTab = "Home" }
    }

    val roleTabs = remember(activeRole) {
        when (activeRole) {
            SchoolRole.ULTRA_ADMIN -> listOf("Home", "Schools", "Subscriptions", "Audit")
            SchoolRole.TEACHER -> listOf("Home", "Teachers DLP", "Recorded AI", "Applications")
            SchoolRole.PRINCIPAL -> listOf("Home", "Teachers DLP", "Recorded AI", "Applications")
            SchoolRole.SUPER_ADMIN -> listOf("Home", "Academic Setup", "Teachers DLP", "Reports")
            SchoolRole.FINANCE -> listOf("Home", "Invoices", "Payroll", "Receipts")
            SchoolRole.PARENT -> listOf("Home", "My Children", "DLP & Notices", "Fees")
            SchoolRole.STUDENT -> listOf("Home", "Homework", "Recorded AI", "Quizzes")
        }
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = WarmBackground,
        contentWindowInsets = WindowInsets.safeDrawing,
        topBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(WarmPaper)
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(TealPrimary),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "G",
                                color = WarmPaper,
                                fontWeight = FontWeight.ExtraBold,
                                fontSize = 20.sp
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = "${currentGreeting()} · ${activeRole.badge}".uppercase(),
                                color = SlateMuted,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "Greenwood School System",
                                color = SlateInk,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.ExtraBold
                            )
                        }
                    }
                    Surface(
                        color = TealSoft,
                        shape = RoundedCornerShape(999.dp)
                    ) {
                        Text(
                            text = activeRole.label,
                            color = TealPrimary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    SchoolRole.entries.forEach { role ->
                        val selected = role == activeRole
                        FilterChip(
                            selected = selected,
                            onClick = {
                                activeRole = role
                                activeTab = "Home"
                                noticeMessage = ""
                            },
                            label = {
                                Text(
                                    text = role.label,
                                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium
                                )
                            },
                            modifier = Modifier.testTag("role_chip_${role.name.lowercase()}")
                        )
                    }
                }
            }
        },
        bottomBar = {
            NavigationBar(
                containerColor = WarmPaper,
                tonalElevation = 2.dp
            ) {
                roleTabs.forEach { tab ->
                    NavigationBarItem(
                        selected = activeTab == tab,
                        onClick = { activeTab = tab },
                        icon = {
                            Icon(
                                imageVector = when (tab) {
                                    "Home" -> Icons.Default.Dashboard
                                    "Schools", "Academic Setup" -> Icons.Default.School
                                    "Teachers DLP", "DLP & Notices" -> Icons.Default.Book
                                    "Recorded AI" -> Icons.Default.OndemandVideo
                                    "Applications" -> Icons.AutoMirrored.Filled.Assignment
                                    "Fees", "Invoices", "Payroll", "Receipts", "Subscriptions" -> Icons.Default.AccountBalanceWallet
                                    else -> Icons.AutoMirrored.Filled.Chat
                                },
                                contentDescription = tab
                            )
                        },
                        label = { Text(tab, fontSize = 11.sp) },
                        modifier = Modifier.testTag("bottom_tab_${tab.lowercase().replace(' ', '_')}")
                    )
                }
            }
        }
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            contentPadding = PaddingValues(vertical = 16.dp)
        ) {
            if (noticeMessage.isNotBlank()) {
                item {
                    Surface(
                        color = TealSoft,
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = noticeMessage,
                                color = TealPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.weight(1f)
                            )
                            TextButton(onClick = { noticeMessage = "" }) {
                                Text("Dismiss")
                            }
                        }
                    }
                }
            }

            // Hero Summary Card
            item {
                Card(
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = DeepSlateSecondary),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(18.dp)) {
                        Text(
                            text = "WARM ACADEMIC PULSE · MULTI-SCHOOL SAAS",
                            color = AmberSoft,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "${activeRole.label} — $activeTab",
                            color = WarmPaper,
                            fontSize = 22.sp,
                            fontWeight = FontWeight.ExtraBold
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "Strict schoolId & branchId isolation · Audience-specific DLP sharing · Teacher-reviewed Gemini AI recorded lessons.",
                            color = TealSoft,
                            fontSize = 13.sp
                        )
                    }
                }
            }

            if (activeRole == SchoolRole.ULTRA_ADMIN) {
                item {
                    UltraAdminPanel(
                        schools = schools,
                        onProvisionSchool = { name, code, plan ->
                            val newSchool = SchoolTenant(
                                id = "sch-${schools.size + 1}",
                                name = name,
                                code = code.uppercase(),
                                status = "active",
                                plan = plan.uppercase(),
                                subscriptionStatus = "trial",
                                verification = "recorded_only",
                                branches = 1,
                                staff = 1,
                                students = 0
                            )
                            schools = listOf(newSchool) + schools
                            noticeMessage = "Provisioned $name ($code) with initial Super Admin."
                        },
                        onToggleStatus = { target ->
                            val next = if (target.status == "active") "suspended" else "active"
                            schools = schools.map {
                                if (it.id == target.id) it.copy(status = next) else it
                            }
                            noticeMessage = "Updated ${target.name} status to $next."
                        }
                    )
                }
            }

            if (activeTab == "Teachers DLP" || activeTab == "DLP & Notices" ||
                (activeTab == "Home" && (activeRole == SchoolRole.TEACHER || activeRole == SchoolRole.PRINCIPAL || activeRole == SchoolRole.PARENT))
            ) {
                item {
                    DlpDirectoryPanel(
                        role = activeRole,
                        dlps = dlpList,
                        onCreateDlp = { title, subject, classId, details, staffNote, parentSummary ->
                            val created = DlpRecordItem(
                                id = "dlp-${dlpList.size + 1}",
                                title = title,
                                subject = subject,
                                classId = classId,
                                section = "A",
                                completionStatus = "completed",
                                completionDetails = details,
                                internalStaffNotes = staffNote,
                                parentSummaryNotes = parentSummary.ifBlank { details },
                                principalStatus = "not_sent",
                                parentShareStatus = "not_shared",
                                version = 1
                            )
                            dlpList = listOf(created) + dlpList
                            noticeMessage = "Saved DLP \"$title\" to staff directory."
                        },
                        onSendToPrincipal = { item ->
                            dlpList = dlpList.map {
                                if (it.id == item.id) it.copy(principalStatus = "pending_review") else it
                            }
                            noticeMessage = "Full DLP version (including staff notes) sent to Principal."
                        },
                        onSendToParents = { item ->
                            dlpList = dlpList.map {
                                if (it.id == item.id) it.copy(parentShareStatus = "shared_with_parents") else it
                            }
                            noticeMessage = "Parent-safe DLP version shared with class Parents (internal staff notes excluded)."
                        }
                    )
                }
            }

            if (activeTab == "Recorded AI" ||
                (activeTab == "Home" && (activeRole == SchoolRole.TEACHER || activeRole == SchoolRole.STUDENT))
            ) {
                item {
                    RecordedLessonsPanel(
                        role = activeRole,
                        lessons = recordedLessons,
                        onUploadLesson = { title, subject, classId, transcript ->
                            val created = RecordedLessonItem(
                                id = "rec-${recordedLessons.size + 1}",
                                title = title,
                                subject = subject,
                                classId = classId,
                                sourceVersion = 1,
                                jobStatus = "ai_draft_ready",
                                summary = "AI Draft Summary for $title ($subject): ${transcript.take(90)}",
                                revisionNotes = "Key concepts extracted from class transcript for teacher review.",
                                teacherReviewed = false,
                                published = false
                            )
                            recordedLessons = listOf(created) + recordedLessons
                            noticeMessage = "Uploaded recorded lesson & generated AI draft. Teacher review required before publishing."
                        },
                        onApproveReview = { item ->
                            recordedLessons = recordedLessons.map {
                                if (it.id == item.id) it.copy(teacherReviewed = true, jobStatus = "teacher_approved") else it
                            }
                            noticeMessage = "Teacher review approved for v${item.sourceVersion}."
                        },
                        onPublishLesson = { item ->
                            if (!item.teacherReviewed) {
                                noticeMessage = "Blocked: Teacher must review and approve AI draft before publishing."
                            } else {
                                recordedLessons = recordedLessons.map {
                                    if (it.id == item.id) it.copy(published = true) else it
                                }
                                noticeMessage = "Published \"${item.title}\" and revision quiz to eligible Students."
                            }
                        }
                    )
                }
            }

            if (activeTab == "Applications" ||
                (activeTab == "Home" && (activeRole == SchoolRole.TEACHER || activeRole == SchoolRole.PRINCIPAL))
            ) {
                item {
                    PrincipalApplicationsPanel(
                        role = activeRole,
                        items = principalApps,
                        onSubmit = { title, message ->
                            val created = PrincipalApplicationItem(
                                id = "app-${principalApps.size + 1}",
                                title = title,
                                category = "teacher_application",
                                message = message,
                                status = "submitted",
                                teacherName = "Sarah Wilson"
                            )
                            principalApps = listOf(created) + principalApps
                            noticeMessage = "Application routed directly to Campus Principal."
                        },
                        onReview = { item, status ->
                            principalApps = principalApps.map {
                                if (it.id == item.id) it.copy(status = status) else it
                            }
                            noticeMessage = "Principal marked application \"${item.title}\" as $status."
                        }
                    )
                }
            }
        }
    }
}

@Composable
fun UltraAdminPanel(
    schools: List<SchoolTenant>,
    onProvisionSchool: (String, String, String) -> Unit,
    onToggleStatus: (SchoolTenant) -> Unit
) {
    var schoolName by remember { mutableStateOf("") }
    var schoolCode by remember { mutableStateOf("") }
    var selectedPlan by remember { mutableStateOf("growth") }

    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = WarmPaper),
        border = BorderStroke(1.dp, WarmBorder),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Ultra Admin · Multi-School Provisioning",
                color = SlateInk,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 16.sp
            )
            Text(
                text = "Provision schools & initial Super Admins. Recorded subscription status is strictly separated from billing-provider settlement.",
                color = SlateMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 4.dp)
            )
            OutlinedTextField(
                value = schoolName,
                onValueChange = { schoolName = it },
                label = { Text("School Name") },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp)
                    .testTag("ultra_school_name_input")
            )
            OutlinedTextField(
                value = schoolCode,
                onValueChange = { schoolCode = it },
                label = { Text("School Code (e.g. GWN)") },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp)
                    .testTag("ultra_school_code_input")
            )
            Button(
                onClick = {
                    if (schoolName.isNotBlank() && schoolCode.isNotBlank()) {
                        onProvisionSchool(schoolName.trim(), schoolCode.trim(), selectedPlan)
                        schoolName = ""
                        schoolCode = ""
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = TealPrimary),
                modifier = Modifier
                    .padding(top = 10.dp)
                    .testTag("provision_school_button")
            ) {
                Text("Provision School & Super Admin")
            }

            Spacer(modifier = Modifier.height(12.dp))
            schools.forEach { school ->
                Surface(
                    color = WarmMutedContainer,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "${school.name} (${school.code})",
                                fontWeight = FontWeight.Bold,
                                color = SlateInk
                            )
                            Text(
                                text = "Status: ${school.status} · Plan: ${school.plan} · ${school.verification}",
                                fontSize = 12.sp,
                                color = SlateMuted
                            )
                        }
                        OutlinedButton(onClick = { onToggleStatus(school) }) {
                            Text(if (school.status == "active") "Suspend" else "Restore")
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun DlpDirectoryPanel(
    role: SchoolRole,
    dlps: List<DlpRecordItem>,
    onCreateDlp: (String, String, String, String, String, String) -> Unit,
    onSendToPrincipal: (DlpRecordItem) -> Unit,
    onSendToParents: (DlpRecordItem) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var subject by remember { mutableStateOf("Mathematics") }
    var classId by remember { mutableStateOf("Grade 9") }
    var details by remember { mutableStateOf("") }
    var staffNote by remember { mutableStateOf("") }
    var parentSummary by remember { mutableStateOf("") }

    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = WarmPaper),
        border = BorderStroke(1.dp, WarmBorder),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = if (role == SchoolRole.PARENT) "Shared Parent Lesson Summaries" else "Staff-Only Teachers DLP Directory",
                color = SlateInk,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 16.sp
            )
            if (role == SchoolRole.TEACHER || role == SchoolRole.PRINCIPAL) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("DLP Lesson Title") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .testTag("dlp_title_input")
                )
                OutlinedTextField(
                    value = details,
                    onValueChange = { details = it },
                    label = { Text("Work-Completion Details") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .testTag("dlp_details_input")
                )
                OutlinedTextField(
                    value = staffNote,
                    onValueChange = { staffNote = it },
                    label = { Text("Internal Staff Notes (Principal/Staff only)") },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                )
                OutlinedTextField(
                    value = parentSummary,
                    onValueChange = { parentSummary = it },
                    label = { Text("Parent-Safe Version Summary") },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                )
                Button(
                    onClick = {
                        if (title.isNotBlank() && details.isNotBlank()) {
                            onCreateDlp(title.trim(), subject, classId, details.trim(), staffNote.trim(), parentSummary.trim())
                            title = ""
                            details = ""
                            staffNote = ""
                            parentSummary = ""
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = TealPrimary),
                    modifier = Modifier
                        .padding(top = 10.dp)
                        .testTag("save_dlp_button")
                ) {
                    Text("Save DLP Record")
                }
            }

            Spacer(modifier = Modifier.height(12.dp))
            dlps.forEach { item ->
                Surface(
                    color = WarmMutedContainer,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "${item.title} · ${item.subject} (${item.classId})",
                            fontWeight = FontWeight.Bold,
                            color = SlateInk
                        )
                        if (role == SchoolRole.PARENT) {
                            Text(
                                text = item.parentSummaryNotes,
                                fontSize = 13.sp,
                                color = SlateInk,
                                modifier = Modifier.padding(top = 4.dp)
                            )
                        } else {
                            Text(
                                text = item.completionDetails,
                                fontSize = 13.sp,
                                color = SlateInk,
                                modifier = Modifier.padding(top = 4.dp)
                            )
                            if (item.internalStaffNotes.isNotBlank()) {
                                Text(
                                    text = "Internal Staff Note: ${item.internalStaffNotes}",
                                    fontSize = 12.sp,
                                    color = DeepSlateSecondary,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(top = 4.dp)
                                )
                            }
                            Text(
                                text = "Principal: ${item.principalStatus} · Parents: ${item.parentShareStatus}",
                                fontSize = 11.sp,
                                color = SlateMuted,
                                modifier = Modifier.padding(top = 4.dp)
                            )
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.padding(top = 8.dp)
                            ) {
                                OutlinedButton(
                                    onClick = { onSendToPrincipal(item) },
                                    modifier = Modifier.testTag("send_dlp_principal_${item.id}")
                                ) {
                                    Text("Send to Principal", fontSize = 12.sp)
                                }
                                Button(
                                    onClick = { onSendToParents(item) },
                                    colors = ButtonDefaults.buttonColors(containerColor = TealPrimary),
                                    modifier = Modifier.testTag("send_dlp_parents_${item.id}")
                                ) {
                                    Text("Send to Parents", fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun RecordedLessonsPanel(
    role: SchoolRole,
    lessons: List<RecordedLessonItem>,
    onUploadLesson: (String, String, String, String) -> Unit,
    onApproveReview: (RecordedLessonItem) -> Unit,
    onPublishLesson: (RecordedLessonItem) -> Unit
) {
    var title by remember { mutableStateOf("") }
    var subject by remember { mutableStateOf("Biology") }
    var transcript by remember { mutableStateOf("") }

    val visibleLessons = if (role == SchoolRole.STUDENT || role == SchoolRole.PARENT) {
        lessons.filter { it.published && it.teacherReviewed }
    } else {
        lessons
    }

    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = WarmPaper),
        border = BorderStroke(1.dp, WarmBorder),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Recorded Lessons & Gemini AI Revision Workflow",
                color = SlateInk,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 16.sp
            )
            Text(
                text = "AI draft summaries, revision notes, and quizzes require explicit Teacher approval on the current source version before Student publication.",
                color = SlateMuted,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 4.dp)
            )

            if (role == SchoolRole.TEACHER || role == SchoolRole.PRINCIPAL) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Recorded Lesson Title") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .testTag("recorded_title_input")
                )
                OutlinedTextField(
                    value = transcript,
                    onValueChange = { transcript = it },
                    label = { Text("Lesson Transcript for Gemini AI Draft") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .testTag("recorded_transcript_input")
                )
                Button(
                    onClick = {
                        if (title.isNotBlank() && transcript.isNotBlank()) {
                            onUploadLesson(title.trim(), subject, "Grade 9 (A)", transcript.trim())
                            title = ""
                            transcript = ""
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = TealPrimary),
                    modifier = Modifier
                        .padding(top = 10.dp)
                        .testTag("upload_recorded_lesson_button")
                ) {
                    Text("Upload & Generate AI Draft")
                }
            }

            Spacer(modifier = Modifier.height(12.dp))
            visibleLessons.forEach { item ->
                Surface(
                    color = WarmMutedContainer,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "${item.title} (${item.subject} · v${item.sourceVersion})",
                            fontWeight = FontWeight.Bold,
                            color = SlateInk
                        )
                        Text(
                            text = "Summary: ${item.summary}",
                            fontSize = 13.sp,
                            color = SlateInk,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                        Text(
                            text = "Revision Notes: ${item.revisionNotes}",
                            fontSize = 12.sp,
                            color = SlateMuted,
                            modifier = Modifier.padding(top = 2.dp)
                        )
                        Text(
                            text = "Teacher Reviewed: ${if (item.teacherReviewed) "Yes" else "Pending"} · Published: ${if (item.published) "Yes" else "No"}",
                            fontSize = 11.sp,
                            color = TealPrimary,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                        if (role == SchoolRole.TEACHER || role == SchoolRole.PRINCIPAL) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.padding(top = 8.dp)
                            ) {
                                OutlinedButton(onClick = { onApproveReview(item) }) {
                                    Text("Approve AI Review", fontSize = 12.sp)
                                }
                                Button(
                                    onClick = { onPublishLesson(item) },
                                    colors = ButtonDefaults.buttonColors(containerColor = TealPrimary)
                                ) {
                                    Text("Publish to Students", fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun PrincipalApplicationsPanel(
    role: SchoolRole,
    items: List<PrincipalApplicationItem>,
    onSubmit: (String, String) -> Unit,
    onReview: (PrincipalApplicationItem, String) -> Unit
) {
    var appTitle by remember { mutableStateOf("") }
    var appMessage by remember { mutableStateOf("") }

    Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = WarmPaper),
        border = BorderStroke(1.dp, WarmBorder),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Teacher → Principal Applications Routing",
                color = SlateInk,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 16.sp
            )
            if (role == SchoolRole.TEACHER) {
                OutlinedTextField(
                    value = appTitle,
                    onValueChange = { appTitle = it },
                    label = { Text("Application Subject / Title") },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                )
                OutlinedTextField(
                    value = appMessage,
                    onValueChange = { appMessage = it },
                    label = { Text("Details for Campus Principal") },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
                )
                Button(
                    onClick = {
                        if (appTitle.isNotBlank() && appMessage.isNotBlank()) {
                            onSubmit(appTitle.trim(), appMessage.trim())
                            appTitle = ""
                            appMessage = ""
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = TealPrimary),
                    modifier = Modifier.padding(top = 10.dp)
                ) {
                    Text("Route to Principal")
                }
            }

            Spacer(modifier = Modifier.height(10.dp))
            items.forEach { item ->
                Surface(
                    color = WarmMutedContainer,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "${item.title} · ${item.teacherName}",
                            fontWeight = FontWeight.Bold,
                            color = SlateInk
                        )
                        Text(
                            text = item.message,
                            fontSize = 13.sp,
                            color = SlateInk,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                        Text(
                            text = "Status: ${item.status}",
                            fontSize = 11.sp,
                            color = TealPrimary,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                        if (role == SchoolRole.PRINCIPAL && item.status == "submitted") {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.padding(top = 8.dp)
                            ) {
                                Button(
                                    onClick = { onReview(item, "approved") },
                                    colors = ButtonDefaults.buttonColors(containerColor = TealPrimary)
                                ) {
                                    Text("Approve", fontSize = 12.sp)
                                }
                                OutlinedButton(onClick = { onReview(item, "rejected") }) {
                                    Text("Reject", fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
