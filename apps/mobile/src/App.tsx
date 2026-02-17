import { useMemo } from "react";
import { useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { NavigationContainer, DarkTheme, DefaultTheme, type Theme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { enableScreens } from "react-native-screens";
import PortalWebViewScreen, { type PortalWebViewRouteParams } from "./screens/PortalWebViewScreen";

enableScreens();

type RootTabParamList = {
  Today: PortalWebViewRouteParams;
  Jobs: PortalWebViewRouteParams;
  Messages: PortalWebViewRouteParams;
  Settings: PortalWebViewRouteParams;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

const TAB_CONFIG: Array<{
  name: keyof RootTabParamList;
  title: string;
  path: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
}> = [
  {
    name: "Today",
    title: "Today",
    path: "/app/today?mobile=1",
    icon: "calendar-outline",
    activeIcon: "calendar",
  },
  {
    name: "Jobs",
    title: "Jobs",
    path: "/app/jobs?mobile=1",
    icon: "briefcase-outline",
    activeIcon: "briefcase",
  },
  {
    name: "Messages",
    title: "Messages",
    path: "/app/messages?mobile=1",
    icon: "chatbubble-ellipses-outline",
    activeIcon: "chatbubble-ellipses",
  },
  {
    name: "Settings",
    title: "Settings",
    path: "/app/settings?mobile=1",
    icon: "settings-outline",
    activeIcon: "settings",
  },
];

function makeTheme(isDark: boolean): Theme {
  const base = isDark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      background: isDark ? "#080f1a" : "#f4f6fa",
      card: isDark ? "#101827" : "#ffffff",
      border: isDark ? "rgba(231, 239, 255, 0.16)" : "rgba(15, 23, 42, 0.14)",
      text: isDark ? "#eaf0fa" : "#111827",
      primary: "#c7a54b",
      notification: "#e36a6a",
    },
  };
}

export default function App() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = useMemo(() => makeTheme(isDark), [isDark]);

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={theme}>
        <StatusBar style={isDark ? "light" : "dark"} />
        <Tab.Navigator
          detachInactiveScreens={false}
          sceneContainerStyle={{ backgroundColor: theme.colors.background }}
          screenOptions={({ route }) => {
            const config = TAB_CONFIG.find((tab) => tab.name === route.name);
            return {
              headerShown: false,
              lazy: false,
              unmountOnBlur: false,
              tabBarHideOnKeyboard: true,
              tabBarActiveTintColor: "#c7a54b",
              tabBarInactiveTintColor: isDark ? "#a8b5c9" : "#5f6c80",
              tabBarStyle: {
                height: 64,
                borderTopWidth: 1,
                borderTopColor: isDark ? "rgba(231, 239, 255, 0.14)" : "rgba(15, 23, 42, 0.12)",
                backgroundColor: isDark ? "#0f1726" : "#ffffff",
                paddingTop: 6,
                paddingBottom: 6,
              },
              tabBarLabelStyle: {
                fontSize: 12,
                fontWeight: "700",
              },
              tabBarIcon: ({ color, size, focused }) => (
                <Ionicons
                  name={focused ? config?.activeIcon ?? "ellipse" : config?.icon ?? "ellipse-outline"}
                  size={size}
                  color={color}
                />
              ),
            };
          }}
        >
          {TAB_CONFIG.map((tab) => (
            <Tab.Screen
              key={tab.name}
              name={tab.name}
              component={PortalWebViewScreen}
              initialParams={{ path: tab.path, title: tab.title }}
              options={{
                title: tab.title,
                tabBarAccessibilityLabel: `${tab.title} tab`,
              }}
            />
          ))}
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
