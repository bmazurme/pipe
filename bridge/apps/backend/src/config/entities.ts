import { ApiKey } from '../auth/entities/api-key.entity';
import { AuthIdentity } from '../auth/entities/auth-identity.entity';
import { EmergencyKey } from '../auth/entities/emergency-key.entity';
import { Session } from '../auth/entities/session.entity';
import { BoardReport } from '../boards/entities/board-report.entity';
import { BoardMetric } from '../boards/entities/board-metric.entity';
import { NasReport } from '../boards/entities/nas-report.entity';
import { ScriptUpdate } from '../boards/entities/script-update.entity';
import { Chat } from '../chat/entities/chat.entity';
import { ChatAttachment } from '../chat/entities/chat-attachment.entity';
import { ChatMessage } from '../chat/entities/chat-message.entity';
import { Context } from '../context/entities/context.entity';
import { ImproveRun } from '../improve/entities/improve-run.entity';
import { ImproveSchedule } from '../improve/entities/improve-schedule.entity';
import { ImproveSettings } from '../improve/entities/improve-settings.entity';
import { LabProject } from '../lab/entities/lab-project.entity';
import { LabRun } from '../lab/entities/lab-run.entity';
import { LabSchedule } from '../lab/entities/lab-schedule.entity';
import { AppLog } from '../logs/entities/app-log.entity';
import { ClientHeartbeat } from '../loop/entities/client-heartbeat.entity';
import { DeployRecord } from '../loop/entities/deploy-record.entity';
import { LoopControl } from '../loop/entities/loop-control.entity';
import { LoopEvent } from '../loop/entities/loop-event.entity';
import { LoopRun } from '../loop/entities/loop-run.entity';
import { TaskQuestion } from '../questions/entities/task-question.entity';
import { PurgeEntry } from '../purge/entities/purge-entry.entity';
import { ReportsSettingsBackup } from '../reports-settings/entities/reports-settings-backup.entity';
import { Secret } from '../secrets/entities/secret.entity';
import { NotificationSettings } from '../telegram/entities/notification-settings.entity';
import { TelegramOutbox } from '../telegram/entities/telegram-outbox.entity';
import { StoredFile } from '../storage/entities/stored-file.entity';
import { DayOff } from '../time/entities/day-off.entity';
import { TimeReportEntry } from '../time/entities/time-report-entry.entity';
import { User } from '../users/entities/user.entity';
import { VpnConnection } from '../vpn/entities/vpn-connection.entity';
import { SystemSettings } from '../dashboard/entities/system-settings.entity';
import { ClaudeCredential } from '../worker/entities/claude-credential.entity';
import { Job } from '../worker/entities/job.entity';
import { LimitAlertState } from '../worker/entities/limit-alert-state.entity';
import { RouterSettingsRow } from '../router/entities/router-settings.entity';
import { ProviderCredential } from '../worker/entities/provider-credential.entity';
import { Worker } from '../worker/entities/worker.entity';
import { WorkerHeartbeat } from '../worker/entities/worker-heartbeat.entity';

// Every entity the app uses, in one place. Both the app's DataSource
// (type-orm.config.ts) and the migration CLI's (data-source.ts) read this:
// autoLoadEntities is off, so a TypeOrmModule.forFeature entity that is missing
// here still boots, then fails its first query with EntityMetadataNotFoundError.
// entities.spec.ts checks every forFeature entity is listed.
export const ENTITIES = [
  SystemSettings,
  TaskQuestion,
  BoardReport,
  NasReport,
  BoardMetric,
  ScriptUpdate,
  User,
  StoredFile,
  PurgeEntry,
  Session,
  ApiKey,
  AuthIdentity,
  EmergencyKey,
  DayOff,
  TimeReportEntry,
  Job,
  Worker,
  ProviderCredential,
  Chat,
  ChatMessage,
  ChatAttachment,
  ClaudeCredential,
  Context,
  VpnConnection,
  WorkerHeartbeat,
  LimitAlertState,
  Secret,
  ReportsSettingsBackup,
  LoopControl,
  DeployRecord,
  LoopRun,
  LoopEvent,
  ClientHeartbeat,
  TelegramOutbox,
  NotificationSettings,
  AppLog,
  ImproveRun,
  ImproveSchedule,
  ImproveSettings,
  LabProject,
  LabSchedule,
  LabRun,
  RouterSettingsRow,
];
