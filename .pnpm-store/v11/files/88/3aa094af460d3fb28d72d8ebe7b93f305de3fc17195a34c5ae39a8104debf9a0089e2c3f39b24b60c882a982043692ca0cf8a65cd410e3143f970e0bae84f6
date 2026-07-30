import type { CSSObject } from '@ant-design/cssinjs';
import type { GenerateStyle } from '../../theme/internal';
import type { NotificationToken } from '.';
interface NotificationItemSharedStyleConfig {
    width: number | string;
    iconFontSize: number | string;
    titleFontSize: number | string;
    titleLineHeight: number | string;
    contentStyle: CSSObject;
    noticeStyle?: CSSObject;
    typeStyle?: boolean;
}
/** Generate item styles shared by Notification and Message notice cards. */
export declare const genListItemSharedStyle: (token: NotificationToken, config: NotificationItemSharedStyleConfig) => CSSObject;
/** Generate standalone PurePanel styles for Notification. */
export declare const genPurePanelStyle: (token: NotificationToken) => CSSObject;
/** Wrap Notification item styles under the component root selector. */
declare const genNotificationStyle: GenerateStyle<NotificationToken, CSSObject>;
export default genNotificationStyle;
