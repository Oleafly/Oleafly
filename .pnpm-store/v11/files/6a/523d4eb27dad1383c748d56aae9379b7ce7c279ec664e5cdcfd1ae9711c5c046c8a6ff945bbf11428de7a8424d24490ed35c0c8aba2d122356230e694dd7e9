/// <reference types="react" />
import { BlockProps } from '@lobehub/ui';
type GuideMode = 'agent' | 'human';
interface GuideItem {
    command: string;
    commandLanguage?: string;
    description: string;
    linkHref?: string;
    linkLabel?: string;
}
interface AgentGuideCardProps extends BlockProps {
    className?: string;
    initialMode?: GuideMode;
    labels: {
        agent: string;
        human: string;
    };
    mode?: GuideMode;
    onModeChange?: (mode: GuideMode) => void;
    sections: {
        agent: GuideItem;
        human: GuideItem;
    };
}
declare const AgentGuideCard: import("react").NamedExoticComponent<AgentGuideCardProps>;
export default AgentGuideCard;
